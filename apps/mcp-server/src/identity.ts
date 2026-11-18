import { readFile } from "node:fs/promises";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { McpContext } from "@nestjs/mcp";
import { type McpConfig, readConfig } from "./config.js";
import { IdentityTokenVerifier, type VerifiedIdentity } from "./verifier.js";

function isVerifiedIdentity(value: unknown): value is VerifiedIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<VerifiedIdentity>;
  return (
    typeof candidate.token === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.organizationId === "string" &&
    Array.isArray(candidate.scopes)
  );
}

/**
 * The caller of an MCP call, always from a verified signed token:
 * - HTTP: the bearer token the module verified (`ctx.authInfo`), never a header or argument of the call;
 * - stdio: the token in `MCP_ACCESS_TOKEN_FILE` or `MCP_ACCESS_TOKEN`, verified again on every call
 *   by the same verifier, so an expired or replaced token stops working at once.
 */
@Injectable()
export class CallerIdentity {
  private readonly config: McpConfig = readConfig();

  constructor(@Inject(IdentityTokenVerifier) private readonly verifier: IdentityTokenVerifier) {}

  async resolve(ctx: McpContext): Promise<VerifiedIdentity> {
    if (ctx.transport === "stdio") return this.stdio();
    const identity = (ctx.authInfo?.extra as { identity?: unknown } | undefined)?.identity;
    if (!isVerifiedIdentity(identity)) throw new UnauthorizedException("Missing verified access token");
    return identity;
  }

  /** The stdio credential, verified. Throws when it is missing, invalid or expired. */
  async stdio(): Promise<VerifiedIdentity> {
    const token = await this.stdioToken();
    if (!token)
      throw new UnauthorizedException(
        "No access token for stdio: set MCP_ACCESS_TOKEN_FILE (preferred) or MCP_ACCESS_TOKEN",
      );
    const identity = await this.verifier.verify(token);
    if (!identity)
      throw new UnauthorizedException(
        "The stdio access token is invalid or expired: issue a new one and update MCP_ACCESS_TOKEN_FILE",
      );
    return identity;
  }

  private async stdioToken(): Promise<string | undefined> {
    if (this.config.MCP_ACCESS_TOKEN_FILE) {
      try {
        return (await readFile(this.config.MCP_ACCESS_TOKEN_FILE, "utf8")).trim() || undefined;
      } catch {
        throw new UnauthorizedException("MCP_ACCESS_TOKEN_FILE cannot be read");
      }
    }
    return this.config.MCP_ACCESS_TOKEN?.trim() || undefined;
  }
}
