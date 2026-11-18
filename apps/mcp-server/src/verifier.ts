import { readFile } from "node:fs/promises";
import { roleSchema, sourceSchema } from "@axial/contracts";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { Injectable } from "@nestjs/common";
import type { McpTokenVerifier } from "@nestjs/mcp";
import { type CryptoKey, createRemoteJWKSet, importSPKI, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";
import { type McpConfig, readConfig } from "./config.js";
import { grantedScopes } from "./scopes.js";

const uuidList = z.array(z.uuid()).max(10_000).default([]);
const claimsSchema = z.object({
  sub: z.uuid(),
  organizationId: z.uuid(),
  role: roleSchema,
  teamIds: uuidList,
  projectIds: uuidList,
  assignableUserIds: uuidList,
  assignableTeamIds: uuidList,
  source: sourceSchema.default("api"),
  scope: z.string().max(2_000).optional(),
  purpose: z.string().optional(),
  exp: z.number().int(),
});

export type IdentityClaims = z.infer<typeof claimsSchema>;

/** What the verifier stores in `AuthInfo.extra`; read back through `CallerIdentity`. */
export interface VerifiedIdentity {
  token: string;
  userId: string;
  organizationId: string;
  role: IdentityClaims["role"];
  teamIds: string[];
  projectIds: string[];
  assignableUserIds: string[];
  assignableTeamIds: string[];
  source: IdentityClaims["source"];
  scopes: string[];
  expiresAt: number;
}

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

  /** Verifies signature, issuer, audience, lifetime and the identity claims. Null means "reject". */
  async verify(token: string): Promise<VerifiedIdentity | null> {
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
    // Password-change tokens are single-purpose and never act on business data.
    if (!claims.success || claims.data.purpose !== undefined) return null;
    const data = claims.data;
    return {
      token,
      userId: data.sub,
      organizationId: data.organizationId,
      role: data.role,
      teamIds: data.teamIds,
      projectIds: data.projectIds,
      assignableUserIds: data.assignableUserIds,
      assignableTeamIds: data.assignableTeamIds,
      source: data.source,
      scopes: grantedScopes(data.role, data.scope),
      expiresAt: data.exp,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo | null> {
    const identity = await this.verify(token);
    if (!identity) return null;
    return {
      token,
      clientId: identity.userId,
      scopes: identity.scopes,
      expiresAt: identity.expiresAt,
      resource: new URL(this.config.MCP_RESOURCE),
      extra: { identity },
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
