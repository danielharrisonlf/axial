import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  type OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createRemoteJWKSet, importSPKI, jwtVerify } from "jose";
import { z } from "zod";
import { type AppConfig, CONFIG } from "../config.js";
import type { AuthenticatedRequest } from "./current-actor.decorator.js";
import { PUBLIC_ROUTE } from "./public.decorator.js";

const uuidList = z.array(z.uuid()).max(10_000).default([]);
const claimsSchema = z.object({
  sub: z.uuid(),
  organizationId: z.uuid(),
  role: z.enum(["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"]),
  teamIds: uuidList,
  projectIds: uuidList,
  assignableUserIds: uuidList,
  assignableTeamIds: uuidList,
  source: z.enum(["ui", "api", "mcp", "automation"]).default("api"),
});

@Injectable()
export class JwtAuthGuard implements CanActivate, OnModuleInit {
  private key: Awaited<ReturnType<typeof importSPKI>> | ReturnType<typeof createRemoteJWKSet> | undefined;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.JWT_PUBLIC_KEY_PATH) {
      this.key = await importSPKI(await readFile(this.config.JWT_PUBLIC_KEY_PATH, "utf8"), "RS256");
    } else if (this.config.JWT_JWKS_URL) {
      this.key = createRemoteJWKSet(new URL(this.config.JWT_JWKS_URL), {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
      });
    } else {
      throw new Error("JWT verification is not configured");
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]))
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !/^Bearer \S+$/i.test(authorization) || !this.key) {
      throw new UnauthorizedException("A valid bearer token is required");
    }
    try {
      const token = authorization.slice(7);
      const options = {
        algorithms: ["RS256"],
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_AUDIENCE,
        requiredClaims: ["exp", "iat", "sub"],
      };
      const verified =
        typeof this.key === "function"
          ? await jwtVerify(token, this.key, options)
          : await jwtVerify(token, this.key, options);
      const claims = claimsSchema.parse(verified.payload);
      request.actor = {
        userId: claims.sub,
        organizationId: claims.organizationId,
        role: claims.role,
        teamIds: claims.teamIds,
        projectIds: claims.projectIds,
        assignableUserIds: claims.assignableUserIds,
        assignableTeamIds: claims.assignableTeamIds,
        source: claims.source,
        correlationId: request.correlationId ?? randomUUID(),
      };
      return true;
    } catch {
      throw new UnauthorizedException("A valid bearer token is required");
    }
  }
}
