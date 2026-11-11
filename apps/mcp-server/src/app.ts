import "reflect-metadata";
import { Controller, Get, Inject, Injectable, Module, ServiceUnavailableException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { McpModule } from "@nestjs/mcp";
import { readConfig } from "./config.js";
import { ProjectsApi, ProjectTools } from "./tools.js";
import { IdentityTokenVerifier } from "./verifier.js";

const config = readConfig();

@Injectable()
class HealthService {
  constructor(@Inject(IdentityTokenVerifier) private readonly verifier: IdentityTokenVerifier) {}

  async ready(): Promise<void> {
    if (!(await this.verifier.ready())) throw new Error("verification key unavailable");
    const response = await fetch(`${config.PROJECTS_API_URL}/api/v1/health/ready`, {
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error("projects unavailable");
  }
}

@Controller("health")
class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    try {
      await this.health.ready();
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException("Not ready");
    }
  }
}

@Module({
  imports: [
    McpModule.forRoot({
      name: "axial-projects",
      version: "1.0.0",
      title: "Axial Projects",
      description: "Projects, tasks and sprints of the Axial delivery workspace.",
      instructions:
        "Use list-projects to discover project ids, then list-tasks or project-summary to read delivery state. " +
        "Read a task with get-task before changing it. create-task and update-task-status change data: confirm " +
        "the intent with the user first, and send the current task version when moving a task.",
      path: "mcp",
      auth: {
        verifier: IdentityTokenVerifier,
        resource: config.MCP_RESOURCE,
        authorizationServers: [config.MCP_JWT_ISSUER],
        scopesSupported: ["projects:read", "projects:write"],
        resourceName: "Axial Projects",
      },
      http: {
        allowedOrigins: config.MCP_ALLOWED_ORIGINS,
        allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
      },
    }),
  ],
  controllers: [HealthController],
  providers: [IdentityTokenVerifier, ProjectsApi, ProjectTools, HealthService],
})
class AppModule {}

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: config.NODE_ENV === "test" ? false : undefined,
  });
  app.enableCors({ origin: config.MCP_ALLOWED_ORIGINS, credentials: false });
  app.useBodyParser("json", { limit: "1mb" });
  app.enableShutdownHooks();
  try {
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
