import "reflect-metadata";
import { Controller, Get, Inject, Injectable, Module, ServiceUnavailableException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { McpModule } from "@nestjs/mcp";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { readConfig } from "./config.js";
import { CallerIdentity } from "./identity.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { McpCallLogInterceptor } from "./mcp/call-log.interceptor.js";
import { McpErrorFilter } from "./mcp/errors.filter.js";
import { StdioScopeGuard } from "./mcp/scope.guard.js";
import { AxialPrompts } from "./prompts.js";
import { AxialResources } from "./resources.js";
import { SUPPORTED_SCOPES } from "./scopes.js";
import { OrganizationTools } from "./tools/organization.tools.js";
import { ProjectTools } from "./tools/projects.tools.js";
import { SprintTools } from "./tools/sprints.tools.js";
import { TaskTools } from "./tools/tasks.tools.js";
import { AxialApi } from "./upstream.js";
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
      version: "2.0.0",
      title: "Kairos Projects",
      description:
        "Projects, tasks, Kanban, sprints, epics, milestones and comments of the Kairos delivery workspace, plus the audit trail, the user's notifications and the organization directory, always as the signed-in user.",
      instructions: SERVER_INSTRUCTIONS,
      path: "mcp",
      auth: {
        verifier: IdentityTokenVerifier,
        resource: config.MCP_RESOURCE,
        authorizationServers: [config.MCP_JWT_ISSUER],
        scopesSupported: SUPPORTED_SCOPES,
        resourceName: "Kairos Projects",
      },
      http: {
        allowedOrigins: config.MCP_ALLOWED_ORIGINS,
        allowedHosts: config.MCP_ALLOWED_HOSTS,
      },
    }),
  ],
  controllers: [HealthController],
  providers: [
    IdentityTokenVerifier,
    CallerIdentity,
    AxialApi,
    StdioScopeGuard,
    McpCallLogInterceptor,
    McpErrorFilter,
    ProjectTools,
    TaskTools,
    SprintTools,
    OrganizationTools,
    AxialResources,
    AxialPrompts,
    HealthService,
  ],
})
export class AppModule {}

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: config.NODE_ENV === "test" ? false : undefined,
  });
  app.enableCors({
    origin: config.MCP_ALLOWED_ORIGINS,
    credentials: false,
    allowedHeaders: ["Authorization", "Content-Type", "Mcp-Protocol-Version", "Mcp-Method", "Mcp-Name"],
    exposedHeaders: ["WWW-Authenticate"],
  });
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
