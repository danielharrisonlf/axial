import "reflect-metadata";
import { createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { config as loadEnv } from "dotenv";
import type { Request, Response } from "express";
import { exportJWK } from "jose";
import type { PoolClient } from "pg";
import { z } from "zod";
import { BETTER_AUTH_BASE_PATH, createAuth } from "./auth.js";
import { pool } from "./db.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  authorizationServerMetadata,
  CODE_CHALLENGE,
  CSRF_COOKIE,
  grantedScopes,
  hashToken,
  isAllowedRedirectUri,
  issuerServesOAuth,
  MAX_REDIRECT_URIS,
  METADATA_ROUTES,
  narrowScopes,
  OAUTH_ROUTES,
  OAUTH_SCOPES,
  OAuthProtocolError,
  type OAuthScope,
  opaqueToken,
  parseCookies,
  REFRESH_TOKEN_TTL_SECONDS,
  redirectDisplay,
  redirectUriMatches,
  redirectWith,
  requestFingerprint,
  safeEqual,
  sameResource,
  signLoginTicket,
  UNPREFIXED_ROUTES,
  verifyLoginTicket,
  verifyPkce,
} from "./oauth.js";
import { renderAuthorizePage, renderErrorPage } from "./oauth-page.js";
import {
  isDelegatedToken,
  isPasswordChangeToken,
  issuer,
  loadKeys,
  signAccessToken,
  signDelegatedAccessToken,
  signPasswordChangeToken,
  verifyAccessToken,
} from "./tokens.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const roles = z.enum(["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"]);
const uuid = z.uuid();
const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const password = z.string().min(14).max(128);
const name = z.string().trim().min(1).max(120);
const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new BadRequestException("Invalid request");
  return result.data;
}
function pathUuid(id: string): string {
  return parse(uuid, id);
}
function betterAuthStatus(error: unknown): string | undefined {
  return (error as { status?: string } | null)?.status;
}
function isDuplicateEmail(error: unknown): boolean {
  const status = betterAuthStatus(error);
  const message = (error as { body?: { message?: string }; message?: string } | null)?.body?.message ?? "";
  return (
    status === "CONFLICT" || status === "UNPROCESSABLE_ENTITY" || /already exists|user already/i.test(message)
  );
}

const db = pool();
const auth = createAuth(db);
const { privateKey, publicKey } = await loadKeys();
// The OAuth endpoints are mounted under /identity, so they exist only for an issuer with that path.
const oauthEnabled = issuerServesOAuth(issuer);
if (!oauthEnabled)
  console.warn(
    `OAuth for MCP clients is disabled: IDENTITY_ISSUER (${issuer}) must be an origin followed by /identity`,
  );
// RFC 8707 resource the OAuth tokens are issued for: the public URL of the MCP server.
const oauthResource = process.env.IDENTITY_OAUTH_RESOURCE ?? "http://localhost:3006/mcp";
{
  const url = new URL(oauthResource);
  if (!["http:", "https:"].includes(url.protocol) || url.hash)
    throw new Error("IDENTITY_OAUTH_RESOURCE must be an http(s) URL without fragment");
}
const secureCookies = new URL(issuer).protocol === "https:";
const betterAuthSecret = process.env.BETTER_AUTH_SECRET;
if (!betterAuthSecret) throw new Error("BETTER_AUTH_SECRET is required");
// Domain-separated key for the organization-selection ticket of the login page.
const ticketKey = createHmac("sha256", betterAuthSecret)
  .update("kairos-oauth-login-ticket")
  .digest("base64url");
const publicJwk = { ...(await exportJWK(publicKey)), alg: "RS256", use: "sig" };
type Role = z.infer<typeof roles>;
interface Actor {
  userId: string;
  organizationId: string;
  role: Role;
  source: "api" | "ui" | "mcp" | "automation";
}
interface Membership {
  role: Role;
  must_change_password: boolean;
}

@Injectable()
class IdentityService {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  private authenticationInFlight = 0;

  async limitAuthentication<T>(ip: string, action: string, work: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
    const key = `${action}:${ip}`;
    const limit = this.attempts.get(key);
    if ((!limit && this.attempts.size >= 10000) || (limit && limit.count >= 20))
      throw new HttpException("Too many attempts", 429);
    if (limit) limit.count++;
    else this.attempts.set(key, { count: 1, until: now + 60000 });
    if (this.authenticationInFlight >= 4) throw new HttpException("Too many attempts", 429);
    this.authenticationInFlight++;
    try {
      return await work();
    } finally {
      this.authenticationInFlight--;
    }
  }

  async membership(userId: string, organizationId: string): Promise<Membership | undefined> {
    const result = await db.query<Membership>(
      `SELECT m.role, u."mustChangePassword" AS must_change_password
         FROM identity.members m
         JOIN identity."user" u ON u.id = m.user_id
         JOIN identity.organizations o ON o.id = m.organization_id
        WHERE m.user_id=$1 AND m.organization_id=$2 AND m.active AND o.active`,
      [userId, organizationId],
    );
    return result.rows[0];
  }

  async claims(
    userId: string,
    organizationId: string,
    role: Role,
  ): Promise<Parameters<typeof signAccessToken>[1]> {
    const [teams, projects, users, assignableTeams] = await Promise.all([
      db.query<{ id: string }>(
        "SELECT tm.team_id AS id FROM identity.team_members tm JOIN identity.teams t ON t.organization_id=tm.organization_id AND t.id=tm.team_id WHERE tm.organization_id=$1 AND tm.user_id=$2 AND t.active ORDER BY tm.team_id",
        [organizationId, userId],
      ),
      db.query<{ id: string }>(
        "SELECT project_id AS id FROM identity.project_assignments WHERE organization_id=$1 AND user_id=$2 ORDER BY project_id",
        [organizationId, userId],
      ),
      db.query<{ id: string }>(
        'SELECT m.user_id AS id FROM identity.members m JOIN identity."user" u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.active ORDER BY m.user_id',
        [organizationId],
      ),
      db.query<{ id: string }>(
        "SELECT id FROM identity.teams WHERE organization_id=$1 AND active ORDER BY id",
        [organizationId],
      ),
    ]);
    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    return {
      userId,
      organizationId,
      role,
      teamIds: ids(teams.rows),
      projectIds: ids(projects.rows),
      assignableUserIds: ids(users.rows),
      assignableTeamIds: ids(assignableTeams.rows),
      source: "api",
    };
  }

  private async jwtActor(
    token: string,
    options: { admin?: boolean; passwordChange?: boolean },
  ): Promise<Actor> {
    let claims: Awaited<ReturnType<typeof verifyAccessToken>>;
    try {
      claims = await verifyAccessToken(publicKey, token, {
        passwordChange: options.passwordChange,
      });
    } catch {
      throw new UnauthorizedException();
    }
    // Tokens delegated to an MCP client are limited to their scopes on the projects API.
    if (isDelegatedToken(claims)) throw new UnauthorizedException();
    const temporary = isPasswordChangeToken(claims);
    if (options.passwordChange ? !temporary : temporary) throw new UnauthorizedException();
    const membership = await this.membership(claims.sub, claims.organizationId);
    if (!membership) throw new UnauthorizedException();
    if (temporary !== membership.must_change_password) throw new UnauthorizedException();
    if (options.admin && membership.role !== "ADMIN") throw new ForbiddenException();
    return {
      userId: claims.sub,
      organizationId: claims.organizationId,
      role: membership.role,
      source: "api",
    };
  }

  private async sessionActor(req: Request, admin = false): Promise<Actor> {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new UnauthorizedException();
    const header = req.headers["x-organization-id"];
    const requested = Array.isArray(header) ? header[0] : header;
    let organizationId: string | undefined;
    if (requested) {
      organizationId = pathUuid(requested);
      const membership = await this.membership(session.user.id, organizationId);
      if (!membership) throw new UnauthorizedException();
      if (membership.must_change_password) throw new UnauthorizedException();
      if (admin && membership.role !== "ADMIN") throw new ForbiddenException();
      return { userId: session.user.id, organizationId, role: membership.role, source: "api" };
    }
    const memberships = await db.query<{ organization_id: string; role: Role }>(
      `SELECT m.organization_id, m.role FROM identity.members m
         JOIN identity."user" u ON u.id=m.user_id
         JOIN identity.organizations o ON o.id=m.organization_id
        WHERE m.user_id=$1 AND m.active AND o.active AND NOT u."mustChangePassword"`,
      [session.user.id],
    );
    if (memberships.rowCount !== 1) throw new UnauthorizedException();
    const only = memberships.rows[0];
    if (!only) throw new UnauthorizedException();
    if (admin && only.role !== "ADMIN") throw new ForbiddenException();
    return {
      userId: session.user.id,
      organizationId: only.organization_id,
      role: only.role,
      source: "api",
    };
  }

  async actor(req: Request, options: { admin?: boolean; passwordChange?: boolean } = {}): Promise<Actor> {
    const authorization = req.headers.authorization;
    if (authorization && /^Bearer \S+$/i.test(authorization)) {
      const token = authorization.slice(7);
      if (token.split(".").length === 3) return this.jwtActor(token, options);
    }
    if (options.passwordChange) throw new UnauthorizedException();
    return this.sessionActor(req, options.admin);
  }

  async login(
    req: Request,
    data: unknown,
  ): Promise<{
    accessToken: string;
    expiresIn: number;
    requiresPasswordChange: boolean;
    sessionToken?: string;
  }> {
    const input = parse(strict({ email, password: z.string().max(128), organizationId: uuid }), data);
    let signedIn: Awaited<ReturnType<typeof auth.api.signInEmail>>;
    try {
      signedIn = await auth.api.signInEmail({
        body: { email: input.email, password: input.password },
        headers: fromNodeHeaders(req.headers),
      });
    } catch {
      throw new UnauthorizedException("Invalid credentials");
    }
    const user = signedIn.user as typeof signedIn.user & { mustChangePassword?: boolean };
    const membership = await this.membership(user.id, input.organizationId);
    if (!membership) throw new UnauthorizedException("Invalid credentials");
    if (membership.must_change_password) {
      const accessToken = await signPasswordChangeToken(privateKey, user.id, input.organizationId);
      return {
        accessToken,
        expiresIn: 300,
        requiresPasswordChange: true,
        sessionToken: signedIn.token,
      };
    }
    const claims = await this.claims(user.id, input.organizationId, membership.role);
    const accessToken = await signAccessToken(privateKey, claims);
    if (Buffer.byteLength(`Bearer ${accessToken}`) > 7000)
      throw new HttpException("Authorization snapshot exceeds the supported header size", 422);
    return {
      accessToken,
      expiresIn: 300,
      requiresPasswordChange: false,
      sessionToken: signedIn.token,
    };
  }

  async exchangeSession(req: Request): Promise<{ accessToken: string; expiresIn: number }> {
    const actor = await this.sessionActor(req);
    const claims = await this.claims(actor.userId, actor.organizationId, actor.role);
    const accessToken = await signAccessToken(privateKey, claims);
    if (Buffer.byteLength(`Bearer ${accessToken}`) > 7000)
      throw new HttpException("Authorization snapshot exceeds the supported header size", 422);
    return { accessToken, expiresIn: 300 };
  }

  async logout(req: Request): Promise<{ signedOut: boolean }> {
    try {
      await auth.api.signOut({ headers: fromNodeHeaders(req.headers) });
    } catch {
      // An already-expired or absent session is still a completed logout.
    }
    return { signedOut: true };
  }

  async changePassword(req: Request, data: unknown): Promise<{ changed: boolean }> {
    const actor = await this.actor(req, { passwordChange: true });
    const input = parse(strict({ currentPassword: z.string().max(128), newPassword: password }), data);
    if (input.currentPassword === input.newPassword)
      throw new BadRequestException("New password must differ");
    const current = await db.query<{ password: string | null }>(
      `SELECT password FROM identity.account WHERE "userId"=$1 AND "providerId"='credential'`,
      [actor.userId],
    );
    const encoded = current.rows[0]?.password;
    if (!encoded || !(await verifyPassword({ hash: encoded, password: input.currentPassword })))
      throw new UnauthorizedException("Invalid credentials");
    const hash = await hashPassword(input.newPassword);
    await db.query(
      `UPDATE identity.account SET password=$2, "updatedAt"=now() WHERE "userId"=$1 AND "providerId"='credential'`,
      [actor.userId, hash],
    );
    await db.query(`UPDATE identity."user" SET "mustChangePassword"=false, "updatedAt"=now() WHERE id=$1`, [
      actor.userId,
    ]);
    await db.query(`DELETE FROM identity.session WHERE "userId"=$1`, [actor.userId]);
    return { changed: true };
  }

  async resetPassword(actor: Actor, rawId: string, data: unknown): Promise<{ changed: boolean }> {
    const userId = pathUuid(rawId);
    const input = parse(strict({ newPassword: password }), data);
    const member = await db.query("SELECT 1 FROM identity.members WHERE organization_id=$1 AND user_id=$2", [
      actor.organizationId,
      userId,
    ]);
    if (!member.rowCount) throw new NotFoundException();
    const hash = await hashPassword(input.newPassword);
    const updated = await db.query(
      `UPDATE identity.account SET password=$2, "updatedAt"=now() WHERE "userId"=$1 AND "providerId"='credential'`,
      [userId, hash],
    );
    if (!updated.rowCount)
      await db.query(
        `INSERT INTO identity.account(id,"providerId","accountId","userId",password) VALUES($1,'credential',$2,$2,$3)`,
        [randomUUID(), userId, hash],
      );
    await db.query(`UPDATE identity."user" SET "mustChangePassword"=true, "updatedAt"=now() WHERE id=$1`, [
      userId,
    ]);
    await db.query(`DELETE FROM identity.session WHERE "userId"=$1`, [userId]);
    return { changed: true };
  }
}

interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
}
interface AuthorizationRequest {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  scopes: OAuthScope[];
  state?: string;
}
type AuthorizationResolution =
  | { kind: "ok"; request: AuthorizationRequest }
  | { kind: "page"; status: number; title: string; message: string }
  | { kind: "redirect"; location: string };
interface Grant {
  clientId: string;
  organizationId: string;
  userId: string;
  scope: string;
  resource: string;
  familyId: string;
}
interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}
type Executor = Pick<PoolClient, "query">;

/** String fields of a query or form; repeated or structured fields are invalid (RFC 6749 §3.1). */
function readFields(source: unknown): { values: Map<string, string>; invalid: Set<string> } {
  const values = new Map<string, string>();
  const invalid = new Set<string>();
  if (typeof source === "object" && source !== null)
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== "string") invalid.add(key);
      else if (value !== "") values.set(key, value);
    }
  return { values, invalid };
}

const registration = z.looseObject({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(MAX_REDIRECT_URIS),
  client_name: z.string().max(500).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

/** OAuth 2.1 authorization server state: clients, codes and refresh token families. */
@Injectable()
class OAuthService {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  async client(clientId: string): Promise<OAuthClient | undefined> {
    if (clientId.length > 200) return undefined;
    const result = await db.query<OAuthClient>(
      "SELECT client_id, client_name, redirect_uris FROM identity.oauth_clients WHERE client_id=$1",
      [clientId],
    );
    return result.rows[0];
  }

  async register(body: unknown): Promise<Record<string, unknown>> {
    const parsed = registration.safeParse(body);
    if (!parsed.success) {
      const redirects = parsed.error.issues.some((issue) => issue.path[0] === "redirect_uris");
      throw redirects
        ? new OAuthProtocolError("invalid_redirect_uri", "redirect_uris must list 1 to 10 URIs")
        : new OAuthProtocolError("invalid_client_metadata", "Invalid client metadata");
    }
    const input = parsed.data;
    if (!input.redirect_uris.every(isAllowedRedirectUri))
      throw new OAuthProtocolError(
        "invalid_redirect_uri",
        "Redirect URIs must use HTTPS, HTTP on a loopback address or a native app scheme",
      );
    if (input.grant_types && !input.grant_types.includes("authorization_code"))
      throw new OAuthProtocolError("invalid_client_metadata", "The authorization_code grant is required");
    if (input.response_types && !input.response_types.includes("code"))
      throw new OAuthProtocolError("invalid_client_metadata", "The code response type is required");
    // Control characters are removed: the name is shown on the consent page.
    const clientName =
      input.client_name
        ?.replace(/\p{Cc}/gu, "")
        .trim()
        .slice(0, 120) || null;
    const clientId = randomUUID();
    const redirectUris = [...new Set(input.redirect_uris)];
    const created = await db.query<{ issued_at: number }>(
      "INSERT INTO identity.oauth_clients(client_id,client_name,redirect_uris) VALUES($1,$2,$3) RETURNING extract(epoch FROM created_at)::bigint AS issued_at",
      [clientId, clientName, redirectUris],
    );
    // Only public clients with PKCE are registered: a requested secret-based method is replaced (RFC 7591 §3.2.1).
    return {
      client_id: clientId,
      client_id_issued_at: Number(created.rows[0]?.issued_at),
      ...(clientName ? { client_name: clientName } : {}),
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH_SCOPES.join(" "),
    };
  }

  /**
   * Validates an authorization request (query of the GET, hidden fields of the POST).
   * Without a known client and registered redirect URI the error is shown on the page;
   * after that, errors go back to the client (RFC 6749 §4.1.2.1).
   */
  async resolve(source: unknown): Promise<AuthorizationResolution> {
    const { values, invalid } = readFields(source);
    const page = (status: number, title: string, message: string): AuthorizationResolution => ({
      kind: "page",
      status,
      title,
      message,
    });
    const clientId = values.get("client_id");
    if (invalid.has("client_id") || !clientId)
      return page(
        400,
        "App não identificado",
        "O pedido de conexão não informou um app. Volte ao app e tente de novo.",
      );
    const client = await this.client(clientId);
    if (!client)
      return page(
        400,
        "App não registrado",
        "Este app não está registrado no Kairos. Remova a conexão no app e adicione de novo.",
      );
    const requested = values.get("redirect_uri");
    let redirectUri: string | undefined;
    if (invalid.has("redirect_uri")) redirectUri = undefined;
    else if (requested)
      redirectUri = client.redirect_uris.some((registered) => redirectUriMatches(registered, requested))
        ? requested
        : undefined;
    else if (client.redirect_uris.length === 1) redirectUri = client.redirect_uris[0];
    if (!redirectUri)
      return page(
        400,
        "Endereço de retorno não autorizado",
        "O app pediu para voltar a um endereço que ele não registrou. Por segurança, a conexão foi interrompida.",
      );
    const target = redirectUri;
    const state = invalid.has("state") ? undefined : values.get("state");
    const fail = (error: string, description: string): AuthorizationResolution => ({
      kind: "redirect",
      location: redirectWith(target, { error, error_description: description, state, iss: issuer }),
    });
    if (invalid.has("state") || (state !== undefined && state.length > 2048))
      return fail("invalid_request", "Invalid state");
    if (invalid.has("response_type") || values.get("response_type") !== "code")
      return fail("unsupported_response_type", "Only the code response type is supported");
    const codeChallenge = values.get("code_challenge");
    if (
      invalid.has("code_challenge") ||
      invalid.has("code_challenge_method") ||
      !codeChallenge ||
      !CODE_CHALLENGE.test(codeChallenge) ||
      values.get("code_challenge_method") !== "S256"
    )
      return fail("invalid_request", "PKCE with the S256 method is required");
    const resource = values.get("resource");
    if (invalid.has("resource") || (resource !== undefined && !sameResource(resource, oauthResource)))
      return fail("invalid_target", "The requested resource is not served by this authorization server");
    if (invalid.has("scope")) return fail("invalid_scope", "Invalid scope");
    return {
      kind: "ok",
      request: { client, redirectUri, codeChallenge, scopes: grantedScopes(values.get("scope")), state },
    };
  }

  /** Checks the password with BetterAuth and lists the organizations the account can use. */
  async authenticate(
    rawEmail: string,
    password: string,
    userAgent: string | undefined,
  ): Promise<
    | { kind: "invalid" }
    | {
        kind: "ok";
        userId: string;
        mustChangePassword: boolean;
        organizations: { id: string; name: string }[];
      }
  > {
    const address = email.safeParse(rawEmail);
    if (!address.success || !password || password.length > 128) return { kind: "invalid" };
    let signedIn: Awaited<ReturnType<typeof auth.api.signInEmail>>;
    try {
      signedIn = await auth.api.signInEmail({
        body: { email: address.data, password },
        headers: new Headers(userAgent ? { "user-agent": userAgent } : {}),
      });
    } catch {
      return { kind: "invalid" };
    }
    // The browser session BetterAuth opens is not used by the OAuth flow.
    await db.query("DELETE FROM identity.session WHERE token=$1", [signedIn.token]);
    const memberships = await db.query<{ id: string; name: string; must_change_password: boolean }>(
      `SELECT o.id, o.name, u."mustChangePassword" AS must_change_password
         FROM identity.members m
         JOIN identity."user" u ON u.id = m.user_id
         JOIN identity.organizations o ON o.id = m.organization_id
        WHERE m.user_id=$1 AND m.active AND o.active
        ORDER BY o.name, o.id`,
      [signedIn.user.id],
    );
    return {
      kind: "ok",
      userId: signedIn.user.id,
      mustChangePassword: memberships.rows.some((row) => row.must_change_password),
      organizations: memberships.rows.map((row) => ({ id: row.id, name: row.name })),
    };
  }

  async issueCode(request: AuthorizationRequest, userId: string, organizationId: string): Promise<string> {
    const code = opaqueToken();
    await db.query(
      `INSERT INTO identity.oauth_authorization_codes
         (code_hash,client_id,organization_id,user_id,redirect_uri,code_challenge,scope,resource,family_id,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + make_interval(secs => $10))`,
      [
        hashToken(code),
        request.client.client_id,
        organizationId,
        userId,
        request.redirectUri,
        request.codeChallenge,
        request.scopes.join(" "),
        oauthResource,
        randomUUID(),
        AUTHORIZATION_CODE_TTL_SECONDS,
      ],
    );
    // Expired rows are kept for a day so that a replayed code still revokes its family.
    await db.query(
      "DELETE FROM identity.oauth_authorization_codes WHERE expires_at < now() - interval '1 day'",
    );
    await db.query("DELETE FROM identity.oauth_refresh_tokens WHERE expires_at < now() - interval '1 day'");
    return code;
  }

  private async clientFor(
    values: Map<string, string>,
    authorization: string | undefined,
  ): Promise<OAuthClient> {
    let clientId = values.get("client_id");
    // Some clients send their public client_id as the Basic user name with an empty secret.
    if (!clientId && authorization && /^Basic \S+$/i.test(authorization)) {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const user = decoded.split(":")[0];
      if (user) {
        try {
          clientId = decodeURIComponent(user);
        } catch {
          throw new OAuthProtocolError("invalid_client", "Malformed client credentials", 401);
        }
      }
    }
    const client = clientId ? await this.client(clientId) : undefined;
    if (!client) throw new OAuthProtocolError("invalid_client", "Unknown client", 401);
    return client;
  }

  private async revokeFamily(executor: Executor, familyId: string): Promise<void> {
    await executor.query(
      "UPDATE identity.oauth_refresh_tokens SET revoked_at=now() WHERE family_id=$1 AND revoked_at IS NULL",
      [familyId],
    );
  }

  /** Active membership whose password is not provisional, re-read on every grant. */
  private async activeRole(grant: Pick<Grant, "userId" | "organizationId">): Promise<Role | undefined> {
    const membership = await this.identity.membership(grant.userId, grant.organizationId);
    return membership && !membership.must_change_password ? membership.role : undefined;
  }

  private async issueTokens(
    executor: Executor,
    grant: Grant,
    role: Role,
    accessScope: string,
  ): Promise<TokenResponse> {
    const claims = await this.identity.claims(grant.userId, grant.organizationId, role);
    const accessToken = await signDelegatedAccessToken(
      privateKey,
      { ...claims, source: "mcp" },
      {
        clientId: grant.clientId,
        scope: accessScope,
        resource: grant.resource,
        expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      },
    );
    if (Buffer.byteLength(`Bearer ${accessToken}`) > 7000)
      throw new OAuthProtocolError(
        "invalid_request",
        "Authorization snapshot exceeds the supported header size",
      );
    const refreshToken = opaqueToken();
    await executor.query(
      `INSERT INTO identity.oauth_refresh_tokens
         (token_hash,family_id,client_id,organization_id,user_id,scope,resource,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8))`,
      [
        hashToken(refreshToken),
        grant.familyId,
        grant.clientId,
        grant.organizationId,
        grant.userId,
        grant.scope,
        grant.resource,
        REFRESH_TOKEN_TTL_SECONDS,
      ],
    );
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: accessScope,
    };
  }

  async token(body: unknown, authorization: string | undefined): Promise<TokenResponse> {
    const { values, invalid } = readFields(body);
    if (invalid.size) throw new OAuthProtocolError("invalid_request", "Parameters must not repeat");
    const grantType = values.get("grant_type");
    if (grantType !== "authorization_code" && grantType !== "refresh_token")
      throw new OAuthProtocolError("unsupported_grant_type", "Unsupported grant type");
    const client = await this.clientFor(values, authorization);
    const resource = values.get("resource");
    return grantType === "authorization_code"
      ? this.authorizationCode(values, client, resource)
      : this.refresh(values, client, resource);
  }

  private async authorizationCode(
    values: Map<string, string>,
    client: OAuthClient,
    resource: string | undefined,
  ): Promise<TokenResponse> {
    const code = values.get("code");
    const verifier = values.get("code_verifier");
    if (!code || !verifier)
      throw new OAuthProtocolError("invalid_request", "code and code_verifier are required");
    const codeHash = hashToken(code);
    // Marking the code used is the first step, so a code is redeemed at most once even concurrently.
    const used = await db.query<{
      client_id: string;
      organization_id: string;
      user_id: string;
      redirect_uri: string;
      code_challenge: string;
      scope: string;
      resource: string;
      family_id: string;
      live: boolean;
    }>(
      `UPDATE identity.oauth_authorization_codes SET used_at=now()
        WHERE code_hash=$1 AND used_at IS NULL
        RETURNING client_id, organization_id, user_id, redirect_uri, code_challenge, scope, resource, family_id,
                  expires_at > now() AS live`,
      [codeHash],
    );
    const row = used.rows[0];
    if (!row) {
      // A replayed code revokes the tokens it already produced (OAuth 2.1 §4.1.3).
      const replayed = await db.query<{ family_id: string }>(
        "SELECT family_id FROM identity.oauth_authorization_codes WHERE code_hash=$1",
        [codeHash],
      );
      const family = replayed.rows[0]?.family_id;
      if (family) await this.revokeFamily(db, family);
      throw new OAuthProtocolError("invalid_grant", "Invalid authorization code");
    }
    if (!row.live || row.client_id !== client.client_id)
      throw new OAuthProtocolError("invalid_grant", "Invalid authorization code");
    const redirectUri = values.get("redirect_uri");
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri)
      throw new OAuthProtocolError("invalid_grant", "redirect_uri does not match the authorization request");
    if (!verifyPkce(verifier, row.code_challenge))
      throw new OAuthProtocolError("invalid_grant", "PKCE verification failed");
    if (resource !== undefined && !sameResource(resource, row.resource))
      throw new OAuthProtocolError("invalid_target", "The resource does not match the authorization request");
    const grant: Grant = {
      clientId: row.client_id,
      organizationId: row.organization_id,
      userId: row.user_id,
      scope: row.scope,
      resource: row.resource,
      familyId: row.family_id,
    };
    const role = await this.activeRole(grant);
    if (!role) throw new OAuthProtocolError("invalid_grant", "The membership is no longer active");
    return this.issueTokens(db, grant, role, grant.scope);
  }

  /** Rotation with reuse detection: a refresh token works once; a second use revokes its family. */
  private async refresh(
    values: Map<string, string>,
    client: OAuthClient,
    resource: string | undefined,
  ): Promise<TokenResponse> {
    const refreshToken = values.get("refresh_token");
    if (!refreshToken) throw new OAuthProtocolError("invalid_request", "refresh_token is required");
    const tokenHash = hashToken(refreshToken);
    const c = await db.connect();
    let outcome: TokenResponse | OAuthProtocolError;
    try {
      await c.query("BEGIN");
      const found = await c.query<{
        family_id: string;
        client_id: string;
        organization_id: string;
        user_id: string;
        scope: string;
        resource: string;
        rotated: boolean;
        revoked: boolean;
        live: boolean;
      }>(
        `SELECT family_id, client_id, organization_id, user_id, scope, resource,
                rotated_at IS NOT NULL AS rotated, revoked_at IS NOT NULL AS revoked, expires_at > now() AS live
           FROM identity.oauth_refresh_tokens WHERE token_hash=$1 FOR UPDATE`,
        [tokenHash],
      );
      const row = found.rows[0];
      if (!row || row.client_id !== client.client_id || row.revoked || !row.live) {
        outcome = new OAuthProtocolError("invalid_grant", "Invalid refresh token");
      } else if (row.rotated) {
        await this.revokeFamily(c, row.family_id);
        outcome = new OAuthProtocolError("invalid_grant", "Refresh token reuse detected");
      } else {
        const grant: Grant = {
          clientId: row.client_id,
          organizationId: row.organization_id,
          userId: row.user_id,
          scope: row.scope,
          resource: row.resource,
          familyId: row.family_id,
        };
        const accessScope = narrowScopes(grant.scope, values.get("scope"));
        const role = await this.activeRole(grant);
        if (accessScope === undefined)
          outcome = new OAuthProtocolError("invalid_scope", "Scope exceeds the grant");
        else if (resource !== undefined && !sameResource(resource, grant.resource))
          outcome = new OAuthProtocolError("invalid_target", "The resource does not match the grant");
        else if (!role) {
          await this.revokeFamily(c, grant.familyId);
          outcome = new OAuthProtocolError("invalid_grant", "The membership is no longer active");
        } else {
          await c.query("UPDATE identity.oauth_refresh_tokens SET rotated_at=now() WHERE token_hash=$1", [
            tokenHash,
          ]);
          outcome = await this.issueTokens(c, grant, role, accessScope);
        }
      }
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
    if (outcome instanceof OAuthProtocolError) throw outcome;
    return outcome;
  }

  /** RFC 7009: revokes the refresh token family; JWT access tokens expire on their own. */
  async revoke(body: unknown, authorization: string | undefined): Promise<void> {
    const { values, invalid } = readFields(body);
    const token = values.get("token");
    if (invalid.size || !token) throw new OAuthProtocolError("invalid_request", "token is required");
    const client = await this.clientFor(values, authorization);
    const found = await db.query<{ family_id: string; client_id: string }>(
      "SELECT family_id, client_id FROM identity.oauth_refresh_tokens WHERE token_hash=$1",
      [hashToken(token)],
    );
    const row = found.rows[0];
    if (row && row.client_id === client.client_id) await this.revokeFamily(db, row.family_id);
  }
}

@Controller()
class IdentityController {
  constructor(@Inject(IdentityService) private readonly service: IdentityService) {}
  @Get("health/live") live() {
    return { status: "ok" };
  }
  @Get("health/ready") async ready() {
    const required = ["001_initial", "002_password_activation", "003_betterauth", "004_oauth"];
    try {
      const result = await db.query("SELECT id FROM identity.schema_migrations WHERE id = ANY($1::text[])", [
        required,
      ]);
      if (result.rowCount !== required.length) throw new ServiceUnavailableException();
      await db.query('SELECT 1 FROM identity."user" LIMIT 1');
    } catch {
      throw new ServiceUnavailableException("Database not ready");
    }
    return { status: "ok" };
  }
  @Post("auth/login") login(@Req() req: Request, @Body() body: unknown) {
    return this.service.limitAuthentication(req.ip ?? "unknown", "login", () =>
      this.service.login(req, body),
    );
  }
  @Post("auth/session") exchangeSession(@Req() req: Request) {
    return this.service.exchangeSession(req);
  }
  @Post("auth/logout") @HttpCode(200) logout(@Req() req: Request) {
    return this.service.logout(req);
  }
  @Get("me") async me(@Req() req: Request) {
    return this.service.actor(req);
  }
  @Get("organization") async organization(@Req() req: Request) {
    const a = await this.service.actor(req);
    return (
      await db.query("SELECT id,name,active FROM identity.organizations WHERE id=$1", [a.organizationId])
    ).rows[0];
  }
  @Patch("organization") async updateOrganization(@Req() req: Request, @Body() body: unknown) {
    const a = await this.service.actor(req, { admin: true });
    const input = parse(strict({ name }), body);
    return (
      await db.query("UPDATE identity.organizations SET name=$2 WHERE id=$1 RETURNING id,name,active", [
        a.organizationId,
        input.name,
      ])
    ).rows[0];
  }
  @Post("organizations") async createOrganization(@Req() req: Request, @Body() body: unknown) {
    const a = await this.service.actor(req, { admin: true });
    const input = parse(strict({ name }), body);
    const id = randomUUID();
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("INSERT INTO identity.organizations(id,name) VALUES($1,$2)", [id, input.name]);
      await c.query("INSERT INTO identity.members(organization_id,user_id,role) VALUES($1,$2,'ADMIN')", [
        id,
        a.userId,
      ]);
      await c.query("COMMIT");
      return { id, name: input.name };
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  @Post("auth/password") changePassword(@Req() req: Request, @Body() body: unknown) {
    return this.service.limitAuthentication(req.ip ?? "unknown", "password", () =>
      this.service.changePassword(req, body),
    );
  }
  @Get("members") async members(@Req() req: Request) {
    const a = await this.service.actor(req, { admin: true });
    return (
      await db.query(
        'SELECT u.id,u.email,m.role,m.active FROM identity.members m JOIN identity."user" u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY u.email',
        [a.organizationId],
      )
    ).rows;
  }
  @Post("members") async createMember(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.service.actor(req, { admin: true });
    const input = parse(strict({ email, password, role: roles, name: name.optional() }), body);
    let created: Awaited<ReturnType<typeof auth.api.signUpEmail>>;
    try {
      created = await auth.api.signUpEmail({
        body: {
          email: input.email,
          password: input.password,
          name: input.name ?? input.email.split("@")[0] ?? input.email,
        },
        headers: fromNodeHeaders(req.headers),
      });
    } catch (error) {
      if (isDuplicateEmail(error)) throw new HttpException("Email already exists", 409);
      throw new BadRequestException("Invalid request");
    }
    try {
      await db.query(`UPDATE identity."user" SET "mustChangePassword"=true WHERE id=$1`, [created.user.id]);
      await db.query("INSERT INTO identity.members(organization_id,user_id,role) VALUES($1,$2,$3)", [
        actor.organizationId,
        created.user.id,
        input.role,
      ]);
      return { id: created.user.id, email: input.email, role: input.role };
    } catch (error) {
      await db.query(`DELETE FROM identity."user" WHERE id=$1`, [created.user.id]);
      throw error;
    }
  }
  @Patch("members/:id") async updateMember(
    @Req() req: Request,
    @Param("id") rawId: string,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req, { admin: true });
    const id = pathUuid(rawId);
    const input = parse(
      strict({ role: roles.optional(), active: z.boolean().optional() }).refine(
        (value) => value.role !== undefined || value.active !== undefined,
      ),
      body,
    );
    if (
      id === actor.userId &&
      ((input.role !== undefined && input.role !== "ADMIN") || input.active === false)
    )
      throw new ForbiddenException("Cannot revoke your own administrator access");
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM identity.organizations WHERE id=$1 FOR UPDATE", [actor.organizationId]);
      const current = await c.query(
        'SELECT 1 FROM identity.members m JOIN identity."user" u ON u.id=m.user_id JOIN identity.organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.role=\'ADMIN\' AND m.active AND NOT u."mustChangePassword" AND o.active',
        [actor.organizationId, actor.userId],
      );
      if (!current.rowCount) throw new ForbiddenException();
      const result = await c.query(
        "UPDATE identity.members SET role=COALESCE($3,role),active=COALESCE($4,active) WHERE organization_id=$1 AND user_id=$2 RETURNING user_id AS id,role,active",
        [actor.organizationId, id, input.role ?? null, input.active ?? null],
      );
      if (!result.rowCount) throw new NotFoundException();
      const remaining = await c.query(
        'SELECT 1 FROM identity.members m JOIN identity."user" u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.role=\'ADMIN\' AND m.active AND NOT u."mustChangePassword" LIMIT 1',
        [actor.organizationId],
      );
      if (!remaining.rowCount)
        throw new HttpException("Organization must retain an active administrator", 409);
      if (input.active === false) await c.query('DELETE FROM identity.session WHERE "userId"=$1', [id]);
      await c.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  @Post("members/:id/password") resetPassword(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service
      .actor(req, { admin: true })
      .then((actor) => this.service.resetPassword(actor, id, body));
  }
  @Get("teams") async teams(@Req() req: Request) {
    const a = await this.service.actor(req, { admin: true });
    return (
      await db.query("SELECT id,name,active FROM identity.teams WHERE organization_id=$1 ORDER BY name", [
        a.organizationId,
      ])
    ).rows;
  }
  @Post("teams") async createTeam(@Req() req: Request, @Body() body: unknown) {
    const a = await this.service.actor(req, { admin: true });
    const input = parse(strict({ name }), body);
    const id = randomUUID();
    await db.query("INSERT INTO identity.teams(organization_id,id,name) VALUES($1,$2,$3)", [
      a.organizationId,
      id,
      input.name,
    ]);
    return { id, name: input.name };
  }
  @Patch("teams/:id") async updateTeam(@Req() req: Request, @Param("id") id: string, @Body() body: unknown) {
    const a = await this.service.actor(req, { admin: true });
    const input = parse(
      strict({ name: name.optional(), active: z.boolean().optional() }).refine(
        (value) => value.name !== undefined || value.active !== undefined,
      ),
      body,
    );
    const result = await db.query(
      "UPDATE identity.teams SET name=COALESCE($3,name),active=COALESCE($4,active) WHERE organization_id=$1 AND id=$2 RETURNING id,name,active",
      [a.organizationId, pathUuid(id), input.name ?? null, input.active ?? null],
    );
    if (!result.rowCount) throw new NotFoundException();
    return result.rows[0];
  }
  @Post("teams/:id/members/:userId") async teamMember(
    @Req() req: Request,
    @Param("id") rawId: string,
    @Param("userId") rawUserId: string,
    @Body() body: unknown,
  ) {
    const a = await this.service.actor(req, { admin: true });
    const input = parse(strict({ enabled: z.boolean() }), body);
    const id = pathUuid(rawId);
    const userId = pathUuid(rawUserId);
    if (input.enabled) {
      const result = await db.query(
        "INSERT INTO identity.team_members(organization_id,team_id,user_id) SELECT $1,t.id,m.user_id FROM identity.teams t JOIN identity.members m ON m.organization_id=t.organization_id WHERE t.organization_id=$1 AND t.id=$2 AND t.active AND m.user_id=$3 AND m.active ON CONFLICT DO NOTHING RETURNING user_id",
        [a.organizationId, id, userId],
      );
      if (!result.rowCount) {
        const existing = await db.query(
          "SELECT 1 FROM identity.team_members WHERE organization_id=$1 AND team_id=$2 AND user_id=$3",
          [a.organizationId, id, userId],
        );
        if (!existing.rowCount) throw new NotFoundException();
      }
    } else
      await db.query(
        "DELETE FROM identity.team_members WHERE organization_id=$1 AND team_id=$2 AND user_id=$3",
        [a.organizationId, id, userId],
      );
    return { enabled: input.enabled };
  }
  @Post("members/:id/projects/:projectId") async project(
    @Req() req: Request,
    @Param("id") rawId: string,
    @Param("projectId") rawProjectId: string,
    @Body() body: unknown,
  ) {
    const a = await this.service.actor(req, { admin: true });
    const input = parse(strict({ enabled: z.boolean() }), body);
    const id = pathUuid(rawId);
    const projectId = pathUuid(rawProjectId);
    if (input.enabled) {
      const result = await db.query(
        "INSERT INTO identity.project_assignments(organization_id,user_id,project_id) SELECT organization_id,user_id,$3 FROM identity.members WHERE organization_id=$1 AND user_id=$2 AND active ON CONFLICT DO NOTHING RETURNING user_id",
        [a.organizationId, id, projectId],
      );
      if (!result.rowCount) {
        const existing = await db.query(
          "SELECT 1 FROM identity.project_assignments WHERE organization_id=$1 AND user_id=$2 AND project_id=$3",
          [a.organizationId, id, projectId],
        );
        if (!existing.rowCount) throw new NotFoundException();
      }
    } else
      await db.query(
        "DELETE FROM identity.project_assignments WHERE organization_id=$1 AND user_id=$2 AND project_id=$3",
        [a.organizationId, id, projectId],
      );
    return { enabled: input.enabled };
  }
}

function sendHtml(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // No form-action: browsers apply it to the redirect back to the client after the POST.
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    })
    .send(html);
}

function sendResolution(res: Response, resolution: Exclude<AuthorizationResolution, { kind: "ok" }>): void {
  if (resolution.kind === "redirect") {
    res.set("cache-control", "no-store").redirect(303, resolution.location);
    return;
  }
  sendHtml(res, resolution.status, renderErrorPage(resolution.title, resolution.message));
}

function sendOAuthError(res: Response, error: unknown): void {
  if (!(error instanceof OAuthProtocolError)) throw error;
  res
    .status(error.status)
    .set({ "cache-control": "no-store", pragma: "no-cache" })
    .json({ error: error.error, error_description: error.description });
}

/** Hidden fields that reproduce a validated authorization request on the POST. */
function requestFields(request: AuthorizationRequest, csrf: string): Record<string, string> {
  return {
    client_id: request.client.client_id,
    redirect_uri: request.redirectUri,
    response_type: "code",
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    scope: request.scopes.join(" "),
    resource: oauthResource,
    ...(request.state !== undefined ? { state: request.state } : {}),
    csrf,
  };
}

function fingerprint(request: AuthorizationRequest): string {
  return requestFingerprint(request.client.client_id, request.redirectUri, request.codeChallenge);
}

/**
 * OAuth 2.1 endpoints for MCP clients, outside the `api/v1` prefix so that they sit
 * under the issuer URL (`<origin>/identity`) as advertised by the metadata.
 */
@Controller()
class OAuthController {
  constructor(
    @Inject(OAuthService) private readonly oauth: OAuthService,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  @Get([...METADATA_ROUTES])
  @Header("cache-control", "public, max-age=300")
  metadata() {
    return authorizationServerMetadata(issuer);
  }

  @Get(OAUTH_ROUTES.jwks)
  @Header("cache-control", "public, max-age=300")
  jwks() {
    return { keys: [publicJwk] };
  }

  @Post(OAUTH_ROUTES.register)
  async register(@Req() req: Request, @Res() res: Response) {
    try {
      const client = await this.identity.limitAuthentication(req.ip ?? "unknown", "oauth-register", () =>
        this.oauth.register(req.body),
      );
      res.status(201).set({ "cache-control": "no-store", pragma: "no-cache" }).json(client);
    } catch (error) {
      sendOAuthError(res, error);
    }
  }

  @Post(OAUTH_ROUTES.token)
  async token(@Req() req: Request, @Res() res: Response) {
    try {
      const tokens = await this.oauth.token(req.body, req.headers.authorization);
      res.status(200).set({ "cache-control": "no-store", pragma: "no-cache" }).json(tokens);
    } catch (error) {
      sendOAuthError(res, error);
    }
  }

  @Post(OAUTH_ROUTES.revoke)
  async revoke(@Req() req: Request, @Res() res: Response) {
    try {
      await this.oauth.revoke(req.body, req.headers.authorization);
      res.status(200).set("cache-control", "no-store").json({});
    } catch (error) {
      sendOAuthError(res, error);
    }
  }

  @Get(OAUTH_ROUTES.authorize)
  async authorize(@Req() req: Request, @Res() res: Response) {
    const resolution = await this.oauth.resolve(req.query);
    if (resolution.kind !== "ok") return sendResolution(res, resolution);
    const existing = parseCookies(req.headers.cookie).get(CSRF_COOKIE);
    // Reused so that two consent tabs of the same browser both stay valid.
    const csrf = existing && /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : opaqueToken();
    res.cookie(CSRF_COOKIE, csrf, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "strict",
      path: "/identity/oauth",
      maxAge: 30 * 60 * 1000,
    });
    sendHtml(res, 200, this.page(resolution.request, csrf, {}));
  }

  private page(
    request: AuthorizationRequest,
    csrf: string,
    extra: {
      email?: string;
      error?: string;
      organizations?: { id: string; name: string }[];
      ticket?: string;
    },
  ): string {
    return renderAuthorizePage({
      clientName: request.client.client_name ?? "Um app",
      redirectHost: redirectDisplay(request.redirectUri),
      scopes: request.scopes,
      hidden: requestFields(request, csrf),
      ...extra,
    });
  }

  @Post(OAUTH_ROUTES.authorize)
  async decide(@Req() req: Request, @Res() res: Response) {
    const { values } = readFields(req.body);
    const cookie = parseCookies(req.headers.cookie).get(CSRF_COOKIE);
    const csrf = values.get("csrf");
    const site = req.headers["sec-fetch-site"];
    if (
      !cookie ||
      !csrf ||
      !safeEqual(cookie, csrf) ||
      (typeof site === "string" && site !== "same-origin" && site !== "none")
    )
      return sendHtml(
        res,
        403,
        renderErrorPage(
          "Formulário expirado",
          "Não foi possível confirmar que este formulário saiu desta página. Volte ao app e tente conectar de novo.",
        ),
      );
    const resolution = await this.oauth.resolve(req.body);
    if (resolution.kind !== "ok") return sendResolution(res, resolution);
    const request = resolution.request;
    if (values.get("decision") === "deny")
      return sendResolution(res, {
        kind: "redirect",
        location: redirectWith(request.redirectUri, {
          error: "access_denied",
          error_description: "The user denied access",
          state: request.state,
          iss: issuer,
        }),
      });

    const ticket = values.get("ticket");
    if (ticket) {
      const userId = verifyLoginTicket(ticketKey, ticket, csrf, fingerprint(request));
      const organizationId = values.get("organizationId");
      if (!userId || !organizationId || !uuid.safeParse(organizationId).success)
        return sendHtml(
          res,
          401,
          this.page(request, csrf, { error: "O tempo para escolher a organização acabou. Entre de novo." }),
        );
      return this.complete(res, request, csrf, userId, organizationId);
    }

    const enteredEmail = values.get("email") ?? "";
    let outcome: Awaited<ReturnType<OAuthService["authenticate"]>>;
    try {
      outcome = await this.identity.limitAuthentication(req.ip ?? "unknown", "oauth-login", () =>
        this.oauth.authenticate(enteredEmail, values.get("password") ?? "", req.headers["user-agent"]),
      );
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429)
        return sendHtml(
          res,
          429,
          this.page(request, csrf, {
            email: enteredEmail,
            error: "Muitas tentativas de login. Aguarde um minuto e tente de novo.",
          }),
        );
      throw error;
    }
    if (outcome.kind === "invalid")
      return sendHtml(
        res,
        401,
        this.page(request, csrf, { email: enteredEmail, error: "E-mail ou senha incorretos." }),
      );
    if (outcome.mustChangePassword)
      return sendHtml(
        res,
        403,
        renderErrorPage(
          "Defina uma nova senha",
          "Sua senha atual é provisória. Entre no Kairos pelo navegador, defina uma nova senha e depois conecte o app de novo.",
        ),
      );
    const [only, ...others] = outcome.organizations;
    if (!only)
      return sendHtml(
        res,
        403,
        renderErrorPage("Sem acesso", "Sua conta não participa de nenhuma organização ativa no Kairos."),
      );
    if (!others.length) return this.complete(res, request, csrf, outcome.userId, only.id);
    return sendHtml(
      res,
      200,
      this.page(request, csrf, {
        organizations: outcome.organizations,
        ticket: signLoginTicket(ticketKey, outcome.userId, csrf, fingerprint(request)),
      }),
    );
  }

  private async complete(
    res: Response,
    request: AuthorizationRequest,
    csrf: string,
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const membership = await this.identity.membership(userId, organizationId);
    if (!membership || membership.must_change_password)
      return sendHtml(
        res,
        403,
        this.page(request, csrf, { error: "Sua conta não tem acesso ativo a esta organização." }),
      );
    const code = await this.oauth.issueCode(request, userId, organizationId);
    sendResolution(res, {
      kind: "redirect",
      location: redirectWith(request.redirectUri, { code, state: request.state, iss: issuer }),
    });
  }
}

@Module({
  controllers: oauthEnabled ? [IdentityController, OAuthController] : [IdentityController],
  providers: [IdentityService, OAuthService],
})
class AppModule {}

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
const origins = (process.env.IDENTITY_TRUSTED_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.enableCors({ origin: origins, credentials: true });
// OAuth endpoints and metadata live under the issuer URL, not under the API prefix.
app.setGlobalPrefix("api/v1", { exclude: UNPREFIXED_ROUTES });
app.enableShutdownHooks();

const handler = toNodeHandler(auth);
app.use((req: Request, res: import("express").Response, next: (error?: unknown) => void) => {
  const path = (req.url ?? "").split("?")[0] ?? "";
  if (!path.startsWith(BETTER_AUTH_BASE_PATH)) {
    next();
    return;
  }
  // Public self-signup would create credentials without organization membership.
  // Accounts are provisioned by an administrator or the bootstrap command.
  if (path.startsWith(`${BETTER_AUTH_BASE_PATH}/sign-up`)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"Not found"}');
    return;
  }
  Promise.resolve(handler(req, res)).catch(() => {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":"Authentication unavailable"}');
    }
  });
});
app.useBodyParser("json", { limit: "256kb" });
// The OAuth login form and token endpoint use application/x-www-form-urlencoded.
app.useBodyParser("urlencoded", { extended: false, limit: "16kb" });

const port = Number(process.env.IDENTITY_PORT ?? "3002");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid IDENTITY_PORT");
await app.listen(port);

for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app
      .close()
      .then(() => db.end())
      .finally(() => process.exit());
  });
