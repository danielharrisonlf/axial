import { readFile } from "node:fs/promises";
import { Injectable } from "@nestjs/common";
import type { McpTokenVerifier } from "@nestjs/mcp";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, importSPKI, jwtVerify, type CryptoKey, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { readConfig, type McpConfig } from "./config.js";

const claimsSchema = z.object({
  sub: z.uuid(),
  organizationId: z.uuid(),
  role: z.enum(["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"]),
  projectIds: z.array(z.uuid()).default([]),
  exp: z.number().int(),
});

export type IdentityClaims = z.infer<typeof claimsSchema>;

/**
 * Accepts the same short-lived RS256 access tokens the rest of Axial uses.
 * The MCP server is a resource server: it verifies locally and never issues tokens.
 */
@Injectable()
export class IdentityTokenVerifier implements McpTokenVerifier {
  private readonly config: McpConfig = readConfig();
  private key: Promise<CryptoKey | JWTVerifyGetKey> | undefined;

  private loadKey(): Promise<CryptoKey | JWTVerifyGetKey> {
    this.key ??= this.config.MCP_JWKS_URL
      ? Promise.resolve(
          createRemoteJWKSet(new URL(this.config.MCP_JWKS_URL), {
            timeoutDuration: 5_000,
            cooldownDuration: 30_000,
          }),
        )
      : readFile(this.config.MCP_PUBLIC_KEY_PATH ?? "", "utf8").then((pem) => importSPKI(pem, "RS256"));
    return this.key;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo | null> {
    const key = await this.loadKey();
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, key, {
        algorithms: ["RS256"],
        issuer: this.config.MCP_JWT_ISSUER,
        audience: this.config.MCP_JWT_AUDIENCE,
        requiredClaims: ["sub", "iat", "exp"],
      }));
    } catch {
      return null;
    }
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return null;
    return {
      token,
      clientId: claims.data.sub,
      scopes: ["projects:read", "projects:write"],
      expiresAt: claims.data.exp,
      resource: new URL(this.config.MCP_RESOURCE),
      extra: {
        token,
        organizationId: claims.data.organizationId,
        role: claims.data.role,
        projectIds: claims.data.projectIds,
      },
    };
  }

  async ready(): Promise<boolean> {
    try {
      await this.loadKey();
      return true;
    } catch {
      return false;
    }
  }
}
