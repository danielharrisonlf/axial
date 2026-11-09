import "reflect-metadata";
import { readFile } from "node:fs/promises";
import {
  BadRequestException,
  Body,
  Controller,
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
  UnauthorizedException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Request } from "express";
import { importSPKI, jwtVerify } from "jose";
import { z } from "zod";
import { startConsumer } from "./consumer.js";
import { db } from "./db.js";

const keyPath = process.env.NOTIFICATIONS_PUBLIC_KEY_PATH;
const issuer = process.env.NOTIFICATIONS_JWT_ISSUER;
const audience = process.env.NOTIFICATIONS_JWT_AUDIENCE;
if (!keyPath || !issuer || !audience) throw new Error("JWT public key, issuer and audience are required");
const key = await importSPKI(await readFile(keyPath, "utf8"), "RS256");
const channel = z.enum(["email", "sms", "whatsapp"]);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException("Invalid request");
  return result.data;
}
@Injectable()
class Service {
  async actor(req: Request) {
    try {
      const auth = req.headers.authorization;
      if (!auth || !/^Bearer \S+$/i.test(auth)) throw new Error();
      const { payload } = await jwtVerify(auth.slice(7), key, {
        algorithms: ["RS256"],
        issuer,
        audience,
        requiredClaims: ["sub", "iat", "exp"],
      });
      return z
        .object({
          sub: z.uuid(),
          organizationId: z.uuid(),
          role: z.enum(["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"]),
        })
        .parse(payload);
    } catch {
      throw new UnauthorizedException();
    }
  }
}
@Controller()
class ControllerImpl {
  constructor(@Inject(Service) private readonly service: Service) {}
  @Get("health/live") live() {
    return { status: "ok" };
  }
  @Get("health/ready") async ready() {
    try {
      const result = await db.query("SELECT id FROM notifications.schema_migrations WHERE id='001_initial'");
      if (!result.rowCount || !(await consumer.ready())) throw new Error();
      return { status: "ok" };
    } catch {
      throw new HttpException("Not ready", 503);
    }
  }
  @Get("notification-preferences") async preferences(@Req() req: Request) {
    const actor = await this.service.actor(req);
    return (
      await db.query(
        "SELECT channel,enabled,destination,updated_at FROM notifications.preferences WHERE organization_id=$1 AND user_id=$2 ORDER BY channel",
        [actor.organizationId, actor.sub],
      )
    ).rows;
  }
  @Patch("notification-preferences/:channel") async preference(
    @Req() req: Request,
    @Param("channel") raw: string,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req);
    const kind = parse(channel, raw);
    const input = parse(
      z.strictObject({ enabled: z.boolean(), destination: z.string().trim().min(1).max(254) }),
      body,
    );
    if (kind === "email") parse(z.email(), input.destination);
    else parse(z.string().regex(/^\+[1-9]\d{7,14}$/), input.destination);
    return (
      await db.query(
        `INSERT INTO notifications.preferences(organization_id,user_id,channel,enabled,destination) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,user_id,channel) DO UPDATE SET enabled=EXCLUDED.enabled,destination=EXCLUDED.destination,updated_at=now() RETURNING channel,enabled,destination,updated_at`,
        [actor.organizationId, actor.sub, kind, input.enabled, input.destination],
      )
    ).rows[0];
  }
  @Get("notifications") async list(@Req() req: Request) {
    const actor = await this.service.actor(req);
    return (
      await db.query(
        "SELECT id,event_id,channel,status,attempts,provider_id,created_at,updated_at FROM notifications.deliveries WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100",
        [actor.organizationId, actor.sub],
      )
    ).rows;
  }
  @Post("notifications/:id/retry") async retry(@Req() req: Request, @Param("id") id: string) {
    const actor = await this.service.actor(req);
    parse(z.uuid(), id);
    const r = await db.query(
      "UPDATE notifications.deliveries SET status='pending',next_attempt_at=now(),last_error=NULL,updated_at=now() WHERE organization_id=$1 AND user_id=$2 AND id=$3 AND status IN ('pending','failed') RETURNING id,status",
      [actor.organizationId, actor.sub, id],
    );
    if (!r.rowCount) {
      const existing = await db.query(
        "SELECT 1 FROM notifications.deliveries WHERE organization_id=$1 AND user_id=$2 AND id=$3",
        [actor.organizationId, actor.sub, id],
      );
      if (!existing.rowCount) throw new NotFoundException();
      throw new HttpException("Delivery cannot be retried", 409);
    }
    return r.rows[0];
  }
}
@Module({ controllers: [ControllerImpl], providers: [Service] })
class AppModule {}
const consumer = startConsumer();
const app = await NestFactory.create(AppModule, { bodyParser: true });
app.setGlobalPrefix("api/v1");
const port = Number(process.env.NOTIFICATIONS_PORT ?? 3003);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid NOTIFICATIONS_PORT");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void (async () => {
      await app.close();
      await consumer.close();
      await db.end();
    })().finally(() => process.exit());
  });
await app.listen(port);
