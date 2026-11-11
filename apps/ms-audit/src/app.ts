import "reflect-metadata";
import { readFile } from "node:fs/promises";
import { auditListSchema, auditSummarySchema, type Role } from "@axial/contracts";
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import compression from "compression";
import type { Request } from "express";
import { importSPKI, jwtVerify } from "jose";
import { z } from "zod";
import { type Consumer, startConsumer } from "./consumer.js";
import { db } from "./db.js";
import { buildCount, buildList, buildWhere, canReadAudit, canReadProject } from "./query.js";

const keyPath = process.env.AUDIT_PUBLIC_KEY_PATH;
const issuer = process.env.AUDIT_JWT_ISSUER;
const audience = process.env.AUDIT_JWT_AUDIENCE;
if (!keyPath || !issuer || !audience) throw new Error("JWT public key, issuer and audience are required");
const key = await importSPKI(await readFile(keyPath, "utf8"), "RS256");
const claimsSchema = z.object({
  sub: z.uuid(),
  organizationId: z.uuid(),
  role: z.enum(["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"]),
  projectIds: z.array(z.uuid()).default([]),
});
interface Actor {
  userId: string;
  organizationId: string;
  role: Role;
  projectIds: string[];
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException("Invalid request");
  return result.data;
}

@Injectable()
class AuditService {
  constructor(@Inject("CONSUMER") private readonly consumer: Consumer) {}

  async actor(req: Request): Promise<Actor> {
    try {
      const authorization = req.headers.authorization;
      if (!authorization || !/^Bearer \S+$/i.test(authorization)) throw new Error();
      const { payload } = await jwtVerify(authorization.slice(7), key, {
        algorithms: ["RS256"],
        issuer,
        audience,
        requiredClaims: ["sub", "iat", "exp"],
      });
      const claims = claimsSchema.parse(payload);
      if (!canReadAudit(claims.role)) throw new ForbiddenException();
      return {
        userId: claims.sub,
        organizationId: claims.organizationId,
        role: claims.role,
        projectIds: claims.projectIds,
      };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException();
    }
  }

  private scope(actor: Actor) {
    return { organizationId: actor.organizationId, role: actor.role, projectIds: actor.projectIds };
  }

  private authorize(actor: Actor, projectId: string | undefined) {
    if (projectId !== undefined && !canReadProject(this.scope(actor), projectId))
      throw new ForbiddenException();
  }

  async list(req: Request, query: unknown) {
    const actor = await this.actor(req);
    const filter = parse(auditListSchema, query);
    this.authorize(actor, filter.projectId);
    const list = buildList(this.scope(actor), filter);
    const count = buildCount(this.scope(actor), filter);
    const [rows, total] = await Promise.all([
      db.query(
        `SELECT id,organization_id AS "organizationId",project_id AS "projectId",event_type AS "eventType",
                aggregate_type AS "aggregateType",aggregate_id AS "aggregateId",
                aggregate_version AS "aggregateVersion",actor_id AS "actorId",
                actor_source AS "actorSource",correlation_id AS "correlationId",
                occurred_at AS "occurredAt",received_at AS "receivedAt",data
           FROM audit.events ${list.where}
          ORDER BY occurred_at DESC, id DESC
          LIMIT $${list.limit} OFFSET $${list.offset}`,
        list.values,
      ),
      db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit.events ${count.where}`,
        count.values,
      ),
    ]);
    return {
      items: rows.rows,
      page: filter.page,
      pageSize: filter.pageSize,
      total: total.rows[0]?.count ?? 0,
    };
  }

  async summary(req: Request, query: unknown) {
    const actor = await this.actor(req);
    const filter = parse(auditSummarySchema, query);
    this.authorize(actor, filter.projectId);
    const { where, values } = buildWhere(this.scope(actor), filter);
    const [total, byEventType, byActor, byDay] = await Promise.all([
      db.query<{ count: number }>(`SELECT count(*)::int AS count FROM audit.events ${where}`, values),
      db.query<{ eventType: string; count: number }>(
        `SELECT event_type AS "eventType",count(*)::int AS count FROM audit.events ${where}
          GROUP BY event_type ORDER BY count DESC,event_type`,
        values,
      ),
      db.query<{ actorId: string; count: number }>(
        `SELECT actor_id AS "actorId",count(*)::int AS count FROM audit.events ${where}
          GROUP BY actor_id ORDER BY count DESC,actor_id LIMIT 20`,
        values,
      ),
      db.query<{ day: string; count: number }>(
        `SELECT to_char(date_trunc('day',occurred_at),'YYYY-MM-DD') AS day,count(*)::int AS count
           FROM audit.events ${where} GROUP BY 1 ORDER BY 1`,
        values,
      ),
    ]);
    return {
      total: total.rows[0]?.count ?? 0,
      byEventType: byEventType.rows,
      byActor: byActor.rows,
      byDay: byDay.rows,
    };
  }

  async ready(): Promise<void> {
    const migration = await db.query("SELECT 1 FROM audit.schema_migrations WHERE id='001_initial'");
    if (!migration.rowCount || !(await this.consumer.ready())) throw new Error("not ready");
  }
}

@Controller()
class AuditController {
  constructor(@Inject(AuditService) private readonly service: AuditService) {}
  @Get("health/live") live() {
    return { status: "ok" };
  }
  @Get("health/ready") async ready() {
    try {
      await this.service.ready();
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException("Not ready");
    }
  }
  @Get("audit") list(@Req() req: Request, @Query() query: unknown) {
    return this.service.list(req, query);
  }
  @Get("audit/summary") summary(@Req() req: Request, @Query() query: unknown) {
    return this.service.summary(req, query);
  }
}

const consumer = startConsumer();

@Module({
  controllers: [AuditController],
  providers: [AuditService, { provide: "CONSUMER", useValue: consumer }],
})
class AppModule {}

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_ENV === "test" ? false : undefined,
  });
  app.setGlobalPrefix("api/v1");
  app.use(compression({ threshold: 1024 }));
  app.enableShutdownHooks();
  try {
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

export async function shutdown(app: NestExpressApplication): Promise<void> {
  await app.close();
  await consumer.close();
  await db.end();
}
