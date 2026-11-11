import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
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
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { config as loadEnv } from "dotenv";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { Request } from "express";
import { z } from "zod";
import { BETTER_AUTH_BASE_PATH, createAuth } from "./auth.js";
import { pool } from "./db.js";
import {
  isPasswordChangeToken,
  loadKeys,
  signAccessToken,
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
    status === "CONFLICT" ||
    status === "UNPROCESSABLE_ENTITY" ||
    /already exists|user already/i.test(message)
  );
}

const db = pool();
const auth = createAuth(db);
const { privateKey, publicKey } = await loadKeys();
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

  private async membership(userId: string, organizationId: string): Promise<Membership | undefined> {
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

  private async claims(
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
        "SELECT m.user_id AS id FROM identity.members m JOIN identity.\"user\" u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.active ORDER BY m.user_id",
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

  async login(req: Request, data: unknown): Promise<{
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
    const member = await db.query(
      "SELECT 1 FROM identity.members WHERE organization_id=$1 AND user_id=$2",
      [actor.organizationId, userId],
    );
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

@Controller()
class IdentityController {
  constructor(@Inject(IdentityService) private readonly service: IdentityService) {}
  @Get("health/live") live() {
    return { status: "ok" };
  }
  @Get("health/ready") async ready() {
    const required = ["001_initial", "002_password_activation", "003_betterauth"];
    try {
      const result = await db.query("SELECT id FROM identity.schema_migrations WHERE id = ANY($1::text[])", [
        required,
      ]);
      if (result.rowCount !== required.length) throw new ServiceUnavailableException();
      await db.query("SELECT 1 FROM identity.\"user\" LIMIT 1");
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
      await db.query(
        `UPDATE identity."user" SET "mustChangePassword"=true WHERE id=$1`,
        [created.user.id],
      );
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
      await c.query("SELECT id FROM identity.organizations WHERE id=$1 FOR UPDATE", [
        actor.organizationId,
      ]);
      const current = await c.query(
        "SELECT 1 FROM identity.members m JOIN identity.\"user\" u ON u.id=m.user_id JOIN identity.organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.role='ADMIN' AND m.active AND NOT u.\"mustChangePassword\" AND o.active",
        [actor.organizationId, actor.userId],
      );
      if (!current.rowCount) throw new ForbiddenException();
      const result = await c.query(
        "UPDATE identity.members SET role=COALESCE($3,role),active=COALESCE($4,active) WHERE organization_id=$1 AND user_id=$2 RETURNING user_id AS id,role,active",
        [actor.organizationId, id, input.role ?? null, input.active ?? null],
      );
      if (!result.rowCount) throw new NotFoundException();
      const remaining = await c.query(
        "SELECT 1 FROM identity.members m JOIN identity.\"user\" u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.role='ADMIN' AND m.active AND NOT u.\"mustChangePassword\" LIMIT 1",
        [actor.organizationId],
      );
      if (!remaining.rowCount)
        throw new HttpException("Organization must retain an active administrator", 409);
      if (input.active === false)
        await c.query('DELETE FROM identity.session WHERE "userId"=$1', [id]);
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
    return this.service.actor(req, { admin: true }).then((actor) =>
      this.service.resetPassword(actor, id, body),
    );
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
  @Patch("teams/:id") async updateTeam(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
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

@Module({ controllers: [IdentityController], providers: [IdentityService] })
class AppModule {}

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
const origins = (process.env.IDENTITY_TRUSTED_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.enableCors({ origin: origins, credentials: true });
app.setGlobalPrefix("api/v1");
app.enableShutdownHooks();

const handler = toNodeHandler(auth);
app.use(
  (
    req: Request,
    res: import("express").Response,
    next: (error?: unknown) => void,
  ) => {
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
  },
);
app.useBodyParser("json", { limit: "256kb" });

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
