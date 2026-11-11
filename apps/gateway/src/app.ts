import "reflect-metadata";
import { Agent as HttpAgent } from "node:http";
import { Controller, Get, Inject, Injectable, Module, ServiceUnavailableException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import compression from "compression";
import { createProxyMiddleware } from "http-proxy-middleware";
import { type GatewayConfig, readConfig } from "./config.js";
import { type RouteName, routeTable } from "./routing.js";

export const GATEWAY_CONFIG = Symbol("GATEWAY_CONFIG");

interface ServiceHealth {
  name: string;
  ok: boolean;
  status: number | "unreachable";
}

@Injectable()
class HealthService {
  constructor(@Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig) {}

  private endpoints(): { name: string; url: string }[] {
    return [
      { name: "projects", url: `${this.config.PROJECTS_API_URL}/api/v1/health/ready` },
      { name: "identity", url: `${this.config.IDENTITY_API_URL}/api/v1/health/ready` },
      { name: "notifications", url: `${this.config.NOTIFICATIONS_API_URL}/api/v1/health/ready` },
      { name: "realtime", url: `${this.config.REALTIME_API_URL}/health/ready` },
      { name: "audit", url: `${this.config.AUDIT_API_URL}/api/v1/health/ready` },
      { name: "mcp", url: `${this.config.MCP_API_URL}/health/ready` },
    ];
  }

  async check(): Promise<ServiceHealth[]> {
    return Promise.all(
      this.endpoints().map(async ({ name, url }) => {
        try {
          const response = await fetch(url, {
            redirect: "error",
            signal: AbortSignal.timeout(2_000),
          });
          return { name, ok: response.ok, status: response.status };
        } catch {
          return { name, ok: false, status: "unreachable" as const };
        }
      }),
    );
  }
}

@Controller("health")
class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}
  @Get("live") live() {
    return { status: "ok" };
  }
  @Get("ready") async ready() {
    const services = await this.health.check();
    if (services.some((service) => !service.ok))
      throw new ServiceUnavailableException({ status: "unavailable", services });
    return { status: "ok", services };
  }
  @Get() async aggregate() {
    const services = await this.health.check();
    return {
      status: services.every((service) => service.ok) ? "ok" : "degraded",
      services,
    };
  }
}

@Module({
  controllers: [HealthController],
  providers: [HealthService, { provide: GATEWAY_CONFIG, useFactory: () => readConfig() }],
})
class AppModule {}

const targets: Record<RouteName, (config: GatewayConfig) => string> = {
  notifications: (config) => config.NOTIFICATIONS_API_URL,
  audit: (config) => config.AUDIT_API_URL,
  identity: (config) => config.IDENTITY_API_URL,
  projects: (config) => config.PROJECTS_API_URL,
  mcp: (config) => config.MCP_API_URL,
};

export interface Gateway {
  app: NestExpressApplication;
  realtime: {
    upgrade: (
      request: import("node:http").IncomingMessage,
      socket: import("node:net").Socket,
      head: Buffer,
    ) => void;
  };
}

export async function createGateway(): Promise<Gateway> {
  const config = readConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: config.NODE_ENV === "test" ? false : undefined,
  });
  app.enableCors({ origin: config.GATEWAY_CORS_ORIGINS, credentials: true });
  app.use(compression({ threshold: 1024 }));

  // http-proxy defaults to `agent: false`, which opens a TCP connection per
  // proxied request. A shared keep-alive pool removes the handshake from the
  // hot path and roughly halves upstream latency under load.
  const upstreamAgent = new HttpAgent({
    keepAlive: true,
    keepAliveMsecs: 30_000,
    maxSockets: 512,
    maxFreeSockets: 64,
  });

  for (const route of routeTable) {
    const target = targets[route.name](config);
    app.use(
      createProxyMiddleware({
        target,
        changeOrigin: true,
        xfwd: true,
        agent: upstreamAgent,
        proxyTimeout: 20_000,
        timeout: 20_000,
        pathFilter: (pathname) =>
          route.prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
        on: {
          error: (error, _request, response) => {
            console.error(`Gateway upstream error for ${route.name}: ${error.message}`);
            if (response && "writeHead" in response && !response.headersSent) {
              response.writeHead(502, { "content-type": "application/json" });
              response.end('{"error":"Upstream unavailable"}');
            }
          },
        },
      }),
    );
  }

  const realtime = createProxyMiddleware({
    target: config.REALTIME_API_URL,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    pathFilter: (pathname) => pathname === "/ws",
    on: {
      error: (error) => console.error(`Gateway realtime error: ${error.message}`),
    },
  });
  app.use(realtime as unknown as import("express").RequestHandler);

  app.useBodyParser("json", { limit: "1mb" });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
  try {
    await app.init();
    return { app, realtime };
  } catch (error) {
    await app.close();
    throw error;
  }
}
