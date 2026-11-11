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
import { channels, notificationEvents, notificationTemplates, providerStatus } from "./catalog.js";
import { startConsumer } from "./consumer.js";
import { db } from "./db.js";
import { beginVerification, confirmVerification, VerificationUnavailableError } from "./verification.js";

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
      const result = await db.query(
        "SELECT id FROM notifications.schema_migrations WHERE id='004_event_preferences'",
      );
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
        "SELECT channel,enabled,destination,verified_at IS NOT NULL AS verified,updated_at FROM notifications.preferences WHERE organization_id=$1 AND user_id=$2 ORDER BY channel",
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
        `INSERT INTO notifications.preferences(organization_id,user_id,channel,enabled,destination) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,user_id,channel) DO UPDATE SET enabled=EXCLUDED.enabled,destination=EXCLUDED.destination,verified_at=CASE WHEN NOT EXCLUDED.enabled OR notifications.preferences.destination IS DISTINCT FROM EXCLUDED.destination THEN NULL ELSE notifications.preferences.verified_at END,updated_at=now() RETURNING channel,enabled,destination,verified_at IS NOT NULL AS verified,updated_at`,
        [actor.organizationId, actor.sub, kind, input.enabled, input.destination],
      )
    ).rows[0];
  }
  @Post("notification-preferences/:channel/verification") async begin(
    @Req() req: Request,
    @Param("channel") raw: string,
  ) {
    const actor = await this.service.actor(req);
    try {
      await beginVerification(actor, parse(channel, raw));
    } catch (error) {
      if (error instanceof VerificationUnavailableError)
        throw new HttpException("Verification unavailable", 503);
      throw error;
    }
    return { requested: true };
  }
  @Post("notification-preferences/:channel/verification/confirm") async confirm(
    @Req() req: Request,
    @Param("channel") raw: string,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req);
    const input = parse(z.strictObject({ code: z.string().regex(/^\d{6}$/) }), body);
    try {
      return { verified: await confirmVerification(actor, parse(channel, raw), input.code) };
    } catch (error) {
      if (error instanceof VerificationUnavailableError)
        throw new HttpException("Verification unavailable", 503);
      throw error;
    }
  }
  @Get("notification-templates") async templates(@Req() req: Request) {
    await this.service.actor(req);
    return notificationTemplates;
  }
  @Get("notification-providers") async providers(@Req() req: Request) {
    await this.service.actor(req);
    return providerStatus();
  }
  @Get("notification-event-preferences") async eventPreferences(@Req() req: Request) {
    const actor = await this.service.actor(req);
    const result = await db.query<{ event_type: string; channel: string; enabled: boolean }>(
      "SELECT event_type,channel,enabled FROM notifications.event_preferences WHERE organization_id=$1 AND user_id=$2",
      [actor.organizationId, actor.sub],
    );
    const stored = new Map(
      result.rows.map((row) => [`${row.event_type}:${row.channel}`, row.enabled] as const),
    );
    return notificationTemplates.flatMap((template) =>
      channels.map((channel) => ({
        event: template.event,
        channel,
        enabled: stored.get(`${template.event}:${channel}`) ?? true,
      })),
    );
  }
  @Patch("notification-event-preferences/:event/:channel") async eventPreference(
    @Req() req: Request,
    @Param("event") event: string,
    @Param("channel") rawChannel: string,
    @Body() body: unknown,
  ) {
    const actor = await this.service.actor(req);
    if (!notificationEvents.has(event)) throw new BadRequestException("Invalid request");
    const kind = parse(channel, rawChannel);
    const input = parse(z.strictObject({ enabled: z.boolean() }), body);
    return (
      await db.query(
        `INSERT INTO notifications.event_preferences(organization_id,user_id,event_type,channel,enabled) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,user_id,event_type,channel) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now() RETURNING event_type AS event,channel,enabled`,
        [actor.organizationId, actor.sub, event, kind, input.enabled],
      )
    ).rows[0];
  }
  @Get("notifications") async list(@Req() req: Request) {
    const actor = await this.service.actor(req);
    return (
      await db.query(
        "SELECT d.id,d.event_id,e.payload->>'type' AS event_type,d.channel,d.status,d.attempts,d.provider_id,d.created_at,d.updated_at FROM notifications.deliveries d JOIN notifications.events e ON e.id=d.event_id AND e.organization_id=d.organization_id WHERE d.organization_id=$1 AND d.user_id=$2 ORDER BY d.created_at DESC LIMIT 100",
        [actor.organizationId, actor.sub],
      )
    ).rows;
  }
  @Get("notifications/:id") async detail(@Req() req: Request, @Param("id") id: string) {
    const actor = await this.service.actor(req);
    parse(z.uuid(), id);
    const result = await db.query(
      "SELECT d.id,d.event_id,e.payload->>'type' AS event_type,d.channel,d.status,d.attempts,d.provider_id,d.last_error,d.created_at,d.updated_at FROM notifications.deliveries d JOIN notifications.events e ON e.id=d.event_id AND e.organization_id=d.organization_id WHERE d.organization_id=$1 AND d.user_id=$2 AND d.id=$3",
      [actor.organizationId, actor.sub, id],
    );
    if (!result.rowCount) throw new NotFoundException();
    return result.rows[0];
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
