import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { fromNodeHeaders } from "better-auth/node";
import type { Request, Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  type Actor,
  email,
  isUniqueViolation,
  type LoginResult,
  type Membership,
  name,
  PASSWORD_MAX_LENGTH,
  parse,
  password,
  pathUuid,
  type Role,
  type Source,
  strict,
  type TokenGrant,
  uuid,
} from "./common.js";
import { parseCookies } from "./oauth.js";
import { auth, db, privateKey, publicKey, settings, transaction } from "./runtime.js";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_COOKIE_PATH,
  sessionTokenFromCookie,
} from "./settings.js";
import {
  isDelegatedToken,
  isPasswordChangeToken,
  signAccessToken,
  signPasswordChangeToken,
  verifyAccessToken,
} from "./tokens.js";

export interface OrganizationMembership {
  organizationId: string;
  organizationName: string;
  role: Role;
  mustChangePassword: boolean;
}

/**
 * A login from the configured Workspace origin is a browser session: it receives the
 * HttpOnly session cookie and its access tokens carry source=ui. The origin only labels
 * the session; it never grants access.
 */
export function isBrowserRequest(req: Request): boolean {
  const origin = req.headers.origin;
  return typeof origin === "string" && settings.IDENTITY_TRUSTED_ORIGINS.includes(origin);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: settings.IDENTITY_SESSION_COOKIE_SECURE,
    sameSite: "lax",
    path: SESSION_COOKIE_PATH,
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: settings.IDENTITY_SESSION_COOKIE_SECURE,
    sameSite: "lax",
    path: SESSION_COOKIE_PATH,
  });
}

/** Sets the cookie for a browser login and returns the body unchanged. */
export function deliverLogin(req: Request, res: Response, result: LoginResult): LoginResult {
  if (isBrowserRequest(req)) setSessionCookie(res, result.sessionToken);
  return result;
}

export function sourceOf(req: Request): Source {
  return isBrowserRequest(req) ? "ui" : "api";
}

@Injectable()
export class IdentityService {
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

  /** Active memberships of the account in active organizations, by organization name. */
  async memberships(userId: string): Promise<OrganizationMembership[]> {
    const result = await db.query<OrganizationMembership>(
      `SELECT o.id AS "organizationId", o.name AS "organizationName", m.role,
              u."mustChangePassword" AS "mustChangePassword"
         FROM identity.members m
         JOIN identity."user" u ON u.id = m.user_id
         JOIN identity.organizations o ON o.id = m.organization_id
        WHERE m.user_id=$1 AND m.active AND o.active
        ORDER BY o.name, o.id`,
      [userId],
    );
    return result.rows;
  }

  async claims(
    userId: string,
    organizationId: string,
    role: Role,
    source: Source = "api",
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
      source,
    };
  }

  private async accessToken(userId: string, organizationId: string, role: Role, source: Source) {
    const accessToken = await signAccessToken(
      privateKey,
      await this.claims(userId, organizationId, role, source),
    );
    if (Buffer.byteLength(`Bearer ${accessToken}`) > 7000)
      throw new HttpException("Authorization snapshot exceeds the supported header size", 422);
    return accessToken;
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
      source: claims.source,
    };
  }

  /**
   * Headers for BetterAuth. A bearer session token wins; otherwise, where allowed, the
   * HttpOnly cookie of a browser session is presented as a bearer token.
   */
  private sessionRequest(req: Request, allowCookie: boolean): { headers: Headers; source: Source } {
    const headers = fromNodeHeaders(req.headers);
    const authorization = req.headers.authorization;
    // An access token (JWT) is not a session: a browser may still send its expired one.
    const sessionBearer =
      authorization && /^Bearer \S+$/i.test(authorization) && authorization.slice(7).split(".").length !== 3;
    if (!allowCookie || sessionBearer) return { headers, source: "api" };
    const token = sessionTokenFromCookie(parseCookies(req.headers.cookie).get(SESSION_COOKIE));
    if (!token) return { headers, source: "api" };
    headers.set("authorization", `Bearer ${token}`);
    return { headers, source: "ui" };
  }

  private async sessionActor(
    req: Request,
    options: { admin?: boolean; allowCookie?: boolean } = {},
  ): Promise<Actor> {
    const { headers, source } = this.sessionRequest(req, options.allowCookie ?? false);
    const session = await auth.api.getSession({ headers });
    if (!session) throw new UnauthorizedException();
    const header = req.headers["x-organization-id"];
    const requested = Array.isArray(header) ? header[0] : header;
    let organizationId: string | undefined;
    if (requested) {
      organizationId = pathUuid(requested);
      const membership = await this.membership(session.user.id, organizationId);
      if (!membership) throw new UnauthorizedException();
      if (membership.must_change_password) throw new UnauthorizedException();
      if (options.admin && membership.role !== "ADMIN") throw new ForbiddenException();
      return { userId: session.user.id, organizationId, role: membership.role, source };
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
    if (options.admin && only.role !== "ADMIN") throw new ForbiddenException();
    return {
      userId: session.user.id,
      organizationId: only.organization_id,
      role: only.role,
      source,
    };
  }

  async actor(req: Request, options: { admin?: boolean; passwordChange?: boolean } = {}): Promise<Actor> {
    const authorization = req.headers.authorization;
    if (authorization && /^Bearer \S+$/i.test(authorization)) {
      const token = authorization.slice(7);
      if (token.split(".").length === 3) return this.jwtActor(token, options);
    }
    if (options.passwordChange) throw new UnauthorizedException();
    return this.sessionActor(req, { admin: options.admin });
  }

  private async revokeSession(sessionToken: string): Promise<void> {
    await db.query("DELETE FROM identity.session WHERE token=$1", [sessionToken]);
  }

  /** Opens a BetterAuth session; the password was already accepted for this account. */
  async openSession(req: Request, address: string, secret: string): Promise<string> {
    const signedIn = await auth.api.signInEmail({
      body: { email: address, password: secret },
      headers: fromNodeHeaders(req.headers),
    });
    return signedIn.token;
  }

  private async grant(
    userId: string,
    organizationId: string,
    membership: Membership,
    sessionToken: string,
    source: Source,
  ): Promise<TokenGrant> {
    if (membership.must_change_password)
      return {
        accessToken: await signPasswordChangeToken(privateKey, userId, organizationId),
        expiresIn: 300,
        requiresPasswordChange: true,
        sessionToken,
      };
    return {
      accessToken: await this.accessToken(userId, organizationId, membership.role, source),
      expiresIn: 300,
      requiresPasswordChange: false,
      sessionToken,
    };
  }

  /**
   * Answers an authenticated account: tokens for the requested organization, for its only
   * organization, or the list to choose from. Without any membership the session is
   * discarded and the answer is the same as for a wrong password.
   */
  async completeLogin(
    userId: string,
    sessionToken: string,
    organizationId: string | undefined,
    source: Source,
  ): Promise<LoginResult> {
    if (organizationId) {
      const membership = await this.membership(userId, organizationId);
      if (!membership) {
        await this.revokeSession(sessionToken);
        throw new UnauthorizedException("Invalid credentials");
      }
      return this.grant(userId, organizationId, membership, sessionToken, source);
    }
    const memberships = await this.memberships(userId);
    const [first] = memberships;
    if (!first) {
      await this.revokeSession(sessionToken);
      throw new UnauthorizedException("Invalid credentials");
    }
    // The provisional password belongs to the account: changing it needs no organization choice.
    if (memberships.length === 1 || first.mustChangePassword)
      return this.grant(
        userId,
        first.organizationId,
        { role: first.role, must_change_password: first.mustChangePassword },
        sessionToken,
        source,
      );
    return {
      requiresOrganization: true,
      organizations: memberships.map((membership) => ({
        id: membership.organizationId,
        name: membership.organizationName,
        role: membership.role,
      })),
      sessionToken,
    };
  }

  async login(req: Request, data: unknown): Promise<LoginResult> {
    const input = parse(
      strict({ email, password: z.string().max(PASSWORD_MAX_LENGTH), organizationId: uuid.optional() }),
      data,
    );
    let signedIn: Awaited<ReturnType<typeof auth.api.signInEmail>>;
    try {
      signedIn = await auth.api.signInEmail({
        body: { email: input.email, password: input.password },
        headers: fromNodeHeaders(req.headers),
      });
    } catch {
      throw new UnauthorizedException("Invalid credentials");
    }
    return this.completeLogin(signedIn.user.id, signedIn.token, input.organizationId, sourceOf(req));
  }

  /**
   * Self-service signup: a new organization with the caller as its administrator. An
   * existing account must prove its password; it is never attached to a new organization
   * otherwise, and a wrong password gets the same answer as any other refusal.
   */
  async signup(req: Request, data: unknown): Promise<LoginResult> {
    if (!settings.IDENTITY_SIGNUP_ENABLED) throw new NotFoundException();
    const input = parse(strict({ name, email, password, organizationName: name }), data);
    const refused = () => new HttpException("Signup could not be completed", 409);
    const organizationId = randomUUID();
    const createOrganization = async (client: PoolClient, userId: string) => {
      await client.query("INSERT INTO identity.organizations(id,name) VALUES($1,$2)", [
        organizationId,
        input.organizationName,
      ]);
      await client.query("INSERT INTO identity.members(organization_id,user_id,role) VALUES($1,$2,'ADMIN')", [
        organizationId,
        userId,
      ]);
    };
    const existing = await db.query<{ id: string }>('SELECT id FROM identity."user" WHERE email=$1', [
      input.email,
    ]);
    const existingId = existing.rows[0]?.id;
    let userId: string;
    let sessionToken: string;
    if (existingId) {
      try {
        sessionToken = await this.openSession(req, input.email, input.password);
      } catch {
        throw refused();
      }
      userId = existingId;
      try {
        await transaction((client) => createOrganization(client, userId));
      } catch (error) {
        await this.revokeSession(sessionToken);
        throw error;
      }
    } else {
      userId = randomUUID();
      const hash = await hashPassword(input.password);
      try {
        await transaction(async (client) => {
          await this.createAccount(client, userId, input.email, input.name, hash);
          await createOrganization(client, userId);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw refused();
        throw error;
      }
      sessionToken = await this.openSession(req, input.email, input.password);
    }
    return this.completeLogin(userId, sessionToken, organizationId, sourceOf(req));
  }

  /** BetterAuth user and credential rows, written in the caller's transaction. */
  async createAccount(
    client: PoolClient,
    userId: string,
    address: string,
    displayName: string,
    passwordHash: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO identity."user"(id,email,name,"emailVerified","mustChangePassword") VALUES($1,$2,$3,false,false)`,
      [userId, address, displayName],
    );
    await client.query(
      `INSERT INTO identity.account(id,"providerId","accountId","userId",password) VALUES($1,'credential',$2::text,$2::uuid,$3)`,
      [randomUUID(), userId, passwordHash],
    );
  }

  async exchangeSession(req: Request): Promise<{ accessToken: string; expiresIn: number }> {
    const actor = await this.sessionActor(req, { allowCookie: true });
    const accessToken = await this.accessToken(actor.userId, actor.organizationId, actor.role, actor.source);
    return { accessToken, expiresIn: 300 };
  }

  async logout(req: Request, res: Response): Promise<{ signedOut: boolean }> {
    clearSessionCookie(res);
    try {
      await auth.api.signOut({ headers: this.sessionRequest(req, true).headers });
    } catch {
      // An already-expired or absent session is still a completed logout.
    }
    return { signedOut: true };
  }

  async me(req: Request) {
    const actor = await this.actor(req);
    const [profile, memberships] = await Promise.all([
      db.query<{ name: string; email: string; title: string | null }>(
        `SELECT u.name, u.email, m.title FROM identity.members m JOIN identity."user" u ON u.id=m.user_id
          WHERE m.organization_id=$1 AND m.user_id=$2`,
        [actor.organizationId, actor.userId],
      ),
      this.memberships(actor.userId),
    ]);
    const row = profile.rows[0];
    if (!row) throw new UnauthorizedException();
    return {
      ...actor,
      name: row.name,
      email: row.email,
      title: row.title,
      memberships: memberships.map(({ organizationId, organizationName, role }) => ({
        organizationId,
        organizationName,
        role,
      })),
    };
  }

  async changePassword(req: Request, data: unknown): Promise<{ changed: boolean }> {
    const actor = await this.actor(req, { passwordChange: true });
    const input = parse(
      strict({ currentPassword: z.string().max(PASSWORD_MAX_LENGTH), newPassword: password }),
      data,
    );
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
        `INSERT INTO identity.account(id,"providerId","accountId","userId",password) VALUES($1,'credential',$2::text,$2::uuid,$3)`,
        [randomUUID(), userId, hash],
      );
    await db.query(`UPDATE identity."user" SET "mustChangePassword"=true, "updatedAt"=now() WHERE id=$1`, [
      userId,
    ]);
    await db.query(`DELETE FROM identity.session WHERE "userId"=$1`, [userId]);
    return { changed: true };
  }
}
