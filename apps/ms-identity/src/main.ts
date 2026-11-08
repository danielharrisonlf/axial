import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
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
import type { Request } from "express";
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { pool } from "./db.js";
import { hashPassword, verifyPassword } from "./password.js";

const roles = z.enum(["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"]);
const uuid = z.uuid();
const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
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
const db = pool();
const issuer = process.env.IDENTITY_ISSUER ?? "http://localhost:3000/identity";
const audience = process.env.IDENTITY_AUDIENCE ?? "axial-projects";
const privatePath = process.env.IDENTITY_PRIVATE_KEY_PATH;
const publicPath = process.env.IDENTITY_PUBLIC_KEY_PATH;
if (!privatePath || !publicPath)
  throw new Error("IDENTITY_PRIVATE_KEY_PATH and IDENTITY_PUBLIC_KEY_PATH are required");
const privateKey = await importPKCS8(await readFile(privatePath, "utf8"), "RS256");
const publicKey = await importSPKI(await readFile(publicPath, "utf8"), "RS256");
const probe = await new SignJWT({})
  .setProtectedHeader({ alg: "RS256" })
  .setIssuedAt()
  .setExpirationTime("1m")
  .sign(privateKey);
await jwtVerify(probe, publicKey, { algorithms: ["RS256"] });
const dummyHash = await hashPassword(randomUUID());
type Actor = { userId: string; organizationId: string };

@Injectable()
class IdentityService {
  // Per-process safeguards supplement account lockout; multi-replica deployments need shared ingress limits.
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
    // Reserve pool capacity for other requests and reject instead of queuing expensive work.
    if (this.authenticationInFlight >= 4) throw new HttpException("Too many attempts", 429);
    this.authenticationInFlight++;
    try {
      return await work();
    } finally {
      this.authenticationInFlight--;
    }
  }
  async actor(req: Request, admin = false, passwordChange = false): Promise<Actor> {
    const auth = req.headers.authorization;
    if (!auth || !/^Bearer \S+$/i.test(auth)) throw new UnauthorizedException();
    try {
      const result = await jwtVerify(auth.slice(7), publicKey, {
        algorithms: ["RS256"],
        issuer,
        audience: passwordChange ? [audience, `${audience}-password-change`] : audience,
        requiredClaims: ["sub", "iat", "exp"],
      });
      const claims = parse(strict({ sub: uuid, organizationId: uuid }).passthrough(), result.payload);
      const current = await db.query(
        "SELECT m.role,u.must_change_password FROM identity.members m JOIN identity.users u ON u.id=m.user_id JOIN identity.organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND m.organization_id=$2 AND m.active AND u.active AND o.active",
        [claims.sub, claims.organizationId],
      );
      if (!current.rowCount) throw new UnauthorizedException();
      const temporary = result.payload.aud === `${audience}-password-change`;
      if (
        temporary &&
        (result.payload.purpose !== "password_change" || !current.rows[0].must_change_password)
      )
        throw new UnauthorizedException();
      if (!temporary && current.rows[0].must_change_password) throw new UnauthorizedException();
      if (admin && current.rows[0].role !== "ADMIN") throw new ForbiddenException();
      return { userId: claims.sub, organizationId: claims.organizationId };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException();
    }
  }
  async login(
    data: unknown,
  ): Promise<{ accessToken: string; expiresIn: number; requiresPasswordChange: boolean }> {
    const input = parse(strict({ email, password: z.string().max(128), organizationId: uuid }), data);
    const client = await db.connect();
    let verifyLocked = false;
    try {
      await client.query("BEGIN");
      const found = await client.query(
        "SELECT id,password_hash,active,locked_until,must_change_password FROM identity.users WHERE email=$1 FOR UPDATE",
        [input.email],
      );
      const user = found.rows[0] as
        | {
            id: string;
            password_hash: string;
            active: boolean;
            locked_until: Date | null;
            must_change_password: boolean;
          }
        | undefined;
      const locked = user?.locked_until && user.locked_until.getTime() > Date.now();
      verifyLocked = Boolean(locked);
      const valid = !locked && (await verifyPassword(input.password, user?.password_hash ?? dummyHash));
      if (!user || !valid || !user.active || locked) {
        if (user && !locked)
          await client.query(
            "UPDATE identity.users SET failed_attempts=failed_attempts+1, locked_until=CASE WHEN failed_attempts+1 >= 5 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1",
            [user.id],
          );
        await client.query("COMMIT");
        throw new UnauthorizedException("Invalid credentials");
      }
      const membership = await client.query(
        "SELECT m.role FROM identity.members m JOIN identity.organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND m.organization_id=$2 AND m.active AND o.active",
        [user.id, input.organizationId],
      );
      if (!membership.rowCount) {
        await client.query("COMMIT");
        throw new UnauthorizedException("Invalid credentials");
      }
      await client.query("UPDATE identity.users SET failed_attempts=0,locked_until=NULL WHERE id=$1", [
        user.id,
      ]);
      if (user.must_change_password) {
        const accessToken = await new SignJWT({
          organizationId: input.organizationId,
          purpose: "password_change",
        })
          .setProtectedHeader({ alg: "RS256", typ: "JWT" })
          .setSubject(user.id)
          .setIssuer(issuer)
          .setAudience(`${audience}-password-change`)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        await client.query("COMMIT");
        return { accessToken, expiresIn: 300, requiresPasswordChange: true };
      }
      const teams = await client.query(
        "SELECT tm.team_id AS id FROM identity.team_members tm JOIN identity.teams t ON t.organization_id=tm.organization_id AND t.id=tm.team_id WHERE tm.organization_id=$1 AND tm.user_id=$2 AND t.active ORDER BY tm.team_id",
        [input.organizationId, user.id],
      );
      const projects = await client.query(
        "SELECT project_id AS id FROM identity.project_assignments WHERE organization_id=$1 AND user_id=$2 ORDER BY project_id",
        [input.organizationId, user.id],
      );
      const users = await client.query(
        "SELECT m.user_id AS id FROM identity.members m JOIN identity.users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.active AND u.active ORDER BY m.user_id",
        [input.organizationId],
      );
      const assignableTeams = await client.query(
        "SELECT id FROM identity.teams WHERE organization_id=$1 AND active ORDER BY id",
        [input.organizationId],
      );
      const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
      const token = await new SignJWT({
        organizationId: input.organizationId,
        role: membership.rows[0].role,
        teamIds: ids(teams.rows),
        projectIds: ids(projects.rows),
        assignableUserIds: ids(users.rows),
        assignableTeamIds: ids(assignableTeams.rows),
        source: "api",
      })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setSubject(user.id)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      if (Buffer.byteLength(`Bearer ${token}`) > 7000)
        throw new HttpException("Authorization snapshot exceeds the supported header size", 422);
      await client.query("COMMIT");
      return { accessToken: token, expiresIn: 300, requiresPasswordChange: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      // Equalize locked and unknown accounts without holding a database connection or row lock.
      if (verifyLocked) await verifyPassword(input.password, dummyHash);
    }
  }
}

@Controller()
class IdentityController {
  constructor(@Inject(IdentityService) private readonly service: IdentityService) {}
  @Get("health/live") live() {
    return { status: "ok" };
  }
  @Get("health/ready") async ready() {
    const required = ["001_initial", "002_password_activation"];
    try {
      const result = await db.query("SELECT id FROM identity.schema_migrations WHERE id = ANY($1::text[])", [
        required,
      ]);
      if (result.rowCount !== required.length) throw new ServiceUnavailableException();
    } catch {
      throw new ServiceUnavailableException("Database not ready");
    }
    return { status: "ok" };
  }
  @Post("auth/login") login(@Body() body: unknown, @Req() req: Request) {
    return this.service.limitAuthentication(req.ip ?? "unknown", "login", () => this.service.login(body));
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
    const a = await this.service.actor(req, true);
    const input = parse(strict({ name }), body);
    return (
      await db.query("UPDATE identity.organizations SET name=$2 WHERE id=$1 RETURNING id,name,active", [
        a.organizationId,
        input.name,
      ])
    ).rows[0];
  }
  @Post("organizations") async createOrganization(@Req() req: Request, @Body() body: unknown) {
    const a = await this.service.actor(req, true);
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
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  @Post("auth/password") async changePassword(@Req() req: Request, @Body() body: unknown) {
    return this.service.limitAuthentication(req.ip ?? "unknown", "password", () =>
      this.changePasswordLimited(req, body),
    );
  }
  private async changePasswordLimited(req: Request, body: unknown) {
    const a = await this.service.actor(req, false, true);
    const input = parse(strict({ currentPassword: z.string().max(128), newPassword: password }), body);
    const c = await db.connect();
    let verifyLocked = false;
    try {
      await c.query("BEGIN");
      const r = await c.query(
        "SELECT password_hash,locked_until FROM identity.users WHERE id=$1 AND active FOR UPDATE",
        [a.userId],
      );
      const user = r.rows[0] as { password_hash: string; locked_until: Date | null } | undefined;
      const locked = user?.locked_until && user.locked_until.getTime() > Date.now();
      verifyLocked = Boolean(locked);
      const valid = user && !locked && (await verifyPassword(input.currentPassword, user.password_hash));
      if (!user || !valid || locked) {
        if (user && !locked)
          await c.query(
            "UPDATE identity.users SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1 >= 5 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1",
            [a.userId],
          );
        await c.query("COMMIT");
        throw new UnauthorizedException("Invalid credentials");
      }
      if (input.currentPassword === input.newPassword)
        throw new BadRequestException("New password must differ");
      const hash = await hashPassword(input.newPassword);
      await c.query(
        "UPDATE identity.users SET password_hash=$2,must_change_password=false,failed_attempts=0,locked_until=NULL WHERE id=$1",
        [a.userId, hash],
      );
      await c.query("COMMIT");
      return { changed: true };
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
      if (verifyLocked) await verifyPassword(input.currentPassword, dummyHash);
    }
  }
  @Get("members") async members(@Req() req: Request) {
    const a = await this.service.actor(req, true);
    return (
      await db.query(
        "SELECT u.id,u.email,m.role,m.active FROM identity.members m JOIN identity.users u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY u.email",
        [a.organizationId],
      )
    ).rows;
  }
  @Post("members") async createMember(@Req() req: Request, @Body() body: unknown) {
    const a = await this.service.actor(req, true);
    const input = parse(strict({ email, password, role: roles }), body);
    const hash = await hashPassword(input.password);
    const id = randomUUID();
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("INSERT INTO identity.users(id,email,password_hash) VALUES($1,$2,$3)", [
        id,
        input.email,
        hash,
      ]);
      await c.query("INSERT INTO identity.members(organization_id,user_id,role) VALUES($1,$2,$3)", [
        a.organizationId,
        id,
        input.role,
      ]);
      await c.query("COMMIT");
      return { id, email: input.email, role: input.role };
    } catch (e) {
      await c.query("ROLLBACK");
      if ((e as { code?: string }).code === "23505") throw new HttpException("Email already exists", 409);
      throw e;
    } finally {
      c.release();
    }
  }
  @Patch("members/:id") async updateMember(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const a = await this.service.actor(req, true);
    id = pathUuid(id);
    const input = parse(
      strict({ role: roles.optional(), active: z.boolean().optional() }).refine(
        (v) => v.role !== undefined || v.active !== undefined,
      ),
      body,
    );
    if (id === a.userId && ((input.role !== undefined && input.role !== "ADMIN") || input.active === false))
      throw new ForbiddenException("Cannot revoke your own administrator access");
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM identity.organizations WHERE id=$1 FOR UPDATE", [a.organizationId]);
      const current = await c.query(
        "SELECT 1 FROM identity.members m JOIN identity.users u ON u.id=m.user_id JOIN identity.organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.role='ADMIN' AND m.active AND u.active AND NOT u.must_change_password AND o.active",
        [a.organizationId, a.userId],
      );
      if (!current.rowCount) throw new ForbiddenException();
      const r = await c.query(
        "UPDATE identity.members SET role=COALESCE($3,role),active=COALESCE($4,active) WHERE organization_id=$1 AND user_id=$2 RETURNING user_id AS id,role,active",
        [a.organizationId, id, input.role ?? null, input.active ?? null],
      );
      if (!r.rowCount) throw new NotFoundException();
      const remaining = await c.query(
        "SELECT 1 FROM identity.members m JOIN identity.users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.role='ADMIN' AND m.active AND u.active AND NOT u.must_change_password LIMIT 1",
        [a.organizationId],
      );
      if (!remaining.rowCount)
        throw new HttpException("Organization must retain an active administrator", 409);
      await c.query("COMMIT");
      return r.rows[0];
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  @Get("teams") async teams(@Req() req: Request) {
    const a = await this.service.actor(req, true);
    return (
      await db.query("SELECT id,name,active FROM identity.teams WHERE organization_id=$1 ORDER BY name", [
        a.organizationId,
      ])
    ).rows;
  }
  @Post("teams") async createTeam(@Req() req: Request, @Body() body: unknown) {
    const a = await this.service.actor(req, true);
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
    const a = await this.service.actor(req, true);
    const input = parse(
      strict({ name: name.optional(), active: z.boolean().optional() }).refine(
        (v) => v.name !== undefined || v.active !== undefined,
      ),
      body,
    );
    const r = await db.query(
      "UPDATE identity.teams SET name=COALESCE($3,name),active=COALESCE($4,active) WHERE organization_id=$1 AND id=$2 RETURNING id,name,active",
      [a.organizationId, pathUuid(id), input.name ?? null, input.active ?? null],
    );
    if (!r.rowCount) throw new NotFoundException();
    return r.rows[0];
  }
  @Post("teams/:id/members/:userId") async teamMember(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    const a = await this.service.actor(req, true);
    const input = parse(strict({ enabled: z.boolean() }), body);
    id = pathUuid(id);
    userId = pathUuid(userId);
    if (input.enabled) {
      const r = await db.query(
        "INSERT INTO identity.team_members(organization_id,team_id,user_id) SELECT $1,t.id,m.user_id FROM identity.teams t JOIN identity.members m ON m.organization_id=t.organization_id JOIN identity.users u ON u.id=m.user_id WHERE t.organization_id=$1 AND t.id=$2 AND t.active AND m.user_id=$3 AND m.active AND u.active ON CONFLICT DO NOTHING RETURNING user_id",
        [a.organizationId, id, userId],
      );
      if (!r.rowCount) {
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
    @Param("id") id: string,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const a = await this.service.actor(req, true);
    const input = parse(strict({ enabled: z.boolean() }), body);
    id = pathUuid(id);
    projectId = pathUuid(projectId);
    if (input.enabled) {
      const r = await db.query(
        "INSERT INTO identity.project_assignments(organization_id,user_id,project_id) SELECT organization_id,user_id,$3 FROM identity.members WHERE organization_id=$1 AND user_id=$2 AND active ON CONFLICT DO NOTHING RETURNING user_id",
        [a.organizationId, id, projectId],
      );
      if (!r.rowCount) {
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
const app = await NestFactory.create(AppModule, { bodyParser: true });
app.setGlobalPrefix("api/v1");
app.enableShutdownHooks();
const port = Number(process.env.IDENTITY_PORT ?? "3002");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid IDENTITY_PORT");
await app.listen(port);
