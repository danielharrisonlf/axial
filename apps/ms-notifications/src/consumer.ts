import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { db } from "./db.js";
import { sendMeta } from "./providers/meta.js";
import { sendResend } from "./providers/resend.js";
import { sendSmsGo } from "./providers/smsgo.js";

const eventSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1).max(100),
  version: z.literal(1),
  occurredAt: z.iso.datetime(),
  organizationId: z.uuid(),
  projectId: z.uuid().nullable(),
  aggregate: z.object({ type: z.string(), id: z.uuid(), version: z.number().int().positive() }),
  actor: z.object({ id: z.uuid(), source: z.string() }),
  correlationId: z.string().max(128),
  data: z.object({ before: z.unknown(), after: z.unknown() }),
});
type Event = { type: string };
export async function ingest(value: unknown): Promise<void> {
  const event = eventSchema.parse(value);
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const inserted = await c.query(
      "INSERT INTO notifications.events(id,organization_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
      [event.id, event.organizationId, JSON.stringify({ type: event.type })],
    );
    if (inserted.rowCount && event.type.startsWith("task.") && event.type !== "task.deleted") {
      const after = z.object({ assigneeId: z.uuid().nullable().optional() }).safeParse(event.data.after);
      if (after.success && after.data.assigneeId) {
        const prefs = await c.query<{ channel: string }>(
          "SELECT channel FROM notifications.preferences WHERE organization_id=$1 AND user_id=$2 AND enabled",
          [event.organizationId, after.data.assigneeId],
        );
        for (const pref of prefs.rows)
          await c.query(
            "INSERT INTO notifications.deliveries(id,event_id,organization_id,user_id,channel) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id,user_id,channel) DO NOTHING",
            [randomUUID(), event.id, event.organizationId, after.data.assigneeId, pref.channel],
          );
      }
    }
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
export interface Provider {
  channels?: readonly string[];
  send(input: { id: string; channel: string; destination: string; event: Event }): Promise<string>;
}
export class HttpProvider implements Provider {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !token.trim() ||
      /[\r\n]/.test(token)
    )
      throw new Error("Invalid provider configuration");
  }
  async send(input: { id: string; channel: string; destination: string; event: Event }): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
        "idempotency-key": input.id,
      },
      body: JSON.stringify({
        id: input.id,
        channel: input.channel,
        destination: input.destination,
        eventType: input.event.type,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    const result = z
      .object({ id: z.string().min(1).max(200), accepted: z.literal(true) })
      .parse(await response.json());
    return result.id;
  }
}
export async function dispatchOne(provider: Provider): Promise<boolean> {
  // A lost lease may mean the provider accepted the request before the process died.
  await db.query(
    "UPDATE notifications.deliveries SET status='unknown',lease_until=NULL,last_error='delivery outcome unknown',updated_at=now() WHERE status='sending' AND lease_until<now()",
  );
  const channels = provider.channels ?? ["email", "sms", "whatsapp"];
  if (!channels.length) return false;
  const c = await db.connect();
  let delivery:
    | {
        id: string;
        channel: string;
        destination: string;
        payload: Event;
        attempts: number;
        organization_id: string;
        user_id: string;
      }
    | undefined;
  try {
    await c.query("BEGIN");
    const result = await c.query<{
      id: string;
      channel: string;
      destination: string;
      payload: Event;
      attempts: number;
      organization_id: string;
      user_id: string;
    }>(
      `SELECT d.id,d.channel,p.destination,e.payload,d.attempts,d.organization_id,d.user_id FROM notifications.deliveries d JOIN notifications.events e ON e.id=d.event_id AND e.organization_id=d.organization_id JOIN notifications.preferences p ON p.organization_id=d.organization_id AND p.user_id=d.user_id AND p.channel=d.channel AND p.enabled AND p.verified_at IS NOT NULL WHERE d.status='pending' AND d.next_attempt_at<=now() AND d.channel=ANY($1::text[]) ORDER BY d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`,
      [channels],
    );
    delivery = result.rows[0];
    if (delivery)
      await c.query(
        "UPDATE notifications.deliveries SET status='sending',attempts=attempts+1,lease_until=now()+interval '1 minute',updated_at=now() WHERE id=$1",
        [delivery.id],
      );
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
  if (!delivery) return false;
  // Recheck the preference immediately before sending; this is not atomic with the external request.
  const preference = await db.query(
    "SELECT 1 FROM notifications.preferences WHERE organization_id=$1 AND user_id=$2 AND channel=$3 AND enabled AND verified_at IS NOT NULL AND destination=$4",
    [delivery.organization_id, delivery.user_id, delivery.channel, delivery.destination],
  );
  if (!preference.rowCount) {
    await db.query(
      "UPDATE notifications.deliveries SET status='pending',lease_until=NULL,updated_at=now() WHERE id=$1 AND status='sending' AND attempts=$2",
      [delivery.id, delivery.attempts + 1],
    );
    return true;
  }
  try {
    const id = await provider.send({
      id: delivery.id,
      channel: delivery.channel,
      destination: delivery.destination,
      event: delivery.payload,
    });
    await db.query(
      "UPDATE notifications.deliveries SET status='accepted',provider_id=$2,lease_until=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND status='sending' AND attempts=$3",
      [delivery.id, id, delivery.attempts + 1],
    );
  } catch {
    await db.query(
      "UPDATE notifications.deliveries SET status='unknown',lease_until=NULL,last_error='delivery outcome unknown',updated_at=now() WHERE id=$1 AND status='sending' AND attempts=$2",
      [delivery.id, delivery.attempts + 1],
    );
  }
  return true;
}
/** Trust is an operator assertion that the external system verifies every destination.
 * This service itself does not verify control of email addresses or phone numbers. */
export function configuredProvider(): Provider | undefined {
  const groups = [
    ["RESEND_API_KEY", "RESEND_FROM"],
    ["SMSGO_API_KEY", "SMSGO_SMS_TYPE_ID"],
    [
      "META_ACCESS_TOKEN",
      "META_PHONE_NUMBER_ID",
      "META_TEMPLATE_NAME",
      "META_LANGUAGE_CODE",
      "META_GRAPH_VERSION",
    ],
  ];
  for (const group of groups) {
    const values = group.map((name) => process.env[name]);
    if (
      values.some((value) => value !== undefined && value !== "") &&
      values.some((value) => !value?.trim())
    ) {
      throw new Error(`Incomplete provider configuration: ${group.join(", ")}`);
    }
  }
  if (
    process.env.SMSGO_SMS_TYPE_ID &&
    (!/^[1-9]\d*$/.test(process.env.SMSGO_SMS_TYPE_ID) ||
      !Number.isSafeInteger(Number(process.env.SMSGO_SMS_TYPE_ID)))
  ) {
    throw new Error("Invalid SMSGO_SMS_TYPE_ID; expected a positive integer");
  }
  if (process.env.NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION !== "true") return undefined;
  const endpoint = process.env.NOTIFICATIONS_PROVIDER_URL;
  const token = process.env.NOTIFICATIONS_PROVIDER_TOKEN;
  if (endpoint || token) {
    if (!endpoint || !token) throw new Error("Configure both provider URL and token");
    return new HttpProvider(endpoint, token);
  }
  const env = process.env;
  const handlers: Record<
    string,
    (input: { id: string; destination: string; eventType: string }) => Promise<string>
  > = {};
  if (env.RESEND_API_KEY && env.RESEND_FROM) {
    const config = { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM };
    handlers.email = (input) => sendResend(input, config);
  }
  if (env.SMSGO_API_KEY && env.SMSGO_SMS_TYPE_ID) {
    const config = { apiKey: env.SMSGO_API_KEY, smsTypeId: Number(env.SMSGO_SMS_TYPE_ID) };
    handlers.sms = (input) => sendSmsGo(input, config);
  }
  if (
    env.META_ACCESS_TOKEN &&
    env.META_PHONE_NUMBER_ID &&
    env.META_TEMPLATE_NAME &&
    env.META_LANGUAGE_CODE &&
    env.META_GRAPH_VERSION
  ) {
    const config = {
      accessToken: env.META_ACCESS_TOKEN,
      phoneNumberId: env.META_PHONE_NUMBER_ID,
      templateName: env.META_TEMPLATE_NAME,
      languageCode: env.META_LANGUAGE_CODE,
      graphVersion: env.META_GRAPH_VERSION,
    };
    handlers.whatsapp = (input) => sendMeta(input, config);
  }
  return {
    channels: Object.keys(handlers),
    send: (input) => {
      const handler = handlers[input.channel];
      if (!handler) throw new Error("Channel is not configured");
      return handler({ id: input.id, destination: input.destination, eventType: input.event.type });
    },
  };
}
export function startConsumer(): { ready: () => Promise<boolean>; close: () => Promise<void> } {
  const redisUrl = process.env.NOTIFICATIONS_REDIS_URL;
  if (!redisUrl) throw new Error("NOTIFICATIONS_REDIS_URL is required");
  const provider = configuredProvider();
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker("axial-notifications", async (job) => ingest(job.data), { connection });
  worker.on("error", (error) => console.error("Notifications worker error", error.message));
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void dispatchOne(
      provider ?? {
        channels: [],
        send: async () => {
          throw new Error("Dispatch disabled");
        },
      },
    )
      .catch((error) => console.error("Dispatch error", error))
      .finally(() => {
        busy = false;
      });
  }, 1000);
  return {
    ready: async () => {
      if (!worker.isRunning() || worker.closing) return false;
      try {
        const client = await Promise.race([
          worker.client,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Redis timeout")), 1500)),
        ]);
        if (client.status !== "ready") return false;
        return await Promise.race([
          connection.ping().then((value) => value === "PONG"),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
        ]);
      } catch {
        return false;
      }
    },
    close: async () => {
      clearInterval(timer);
      await worker.close();
      await connection.quit();
    },
  };
}
