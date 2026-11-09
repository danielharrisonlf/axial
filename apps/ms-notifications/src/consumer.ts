import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { db } from "./db.js";

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
  const c = await db.connect();
  let delivery:
    | { id: string; channel: string; destination: string; payload: Event; attempts: number }
    | undefined;
  try {
    await c.query("BEGIN");
    const result = await c.query<{
      id: string;
      channel: string;
      destination: string;
      payload: Event;
      attempts: number;
    }>(
      `SELECT d.id,d.channel,p.destination,e.payload,d.attempts FROM notifications.deliveries d JOIN notifications.events e ON e.id=d.event_id JOIN notifications.preferences p ON p.organization_id=d.organization_id AND p.user_id=d.user_id AND p.channel=d.channel AND p.enabled WHERE (d.status='pending' AND d.next_attempt_at<=now()) OR (d.status='sending' AND d.lease_until<now()) ORDER BY d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`,
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
      "UPDATE notifications.deliveries SET status='pending',lease_until=NULL,last_error='provider request failed',next_attempt_at=now()+make_interval(secs => LEAST(900, 5 * power(2, LEAST(attempts,7))::int)),updated_at=now() WHERE id=$1 AND status='sending' AND attempts=$2",
      [delivery.id, delivery.attempts + 1],
    );
  }
  return true;
}
export function startConsumer(): { ready: () => Promise<boolean>; close: () => Promise<void> } {
  const redisUrl = process.env.NOTIFICATIONS_REDIS_URL;
  if (!redisUrl) throw new Error("NOTIFICATIONS_REDIS_URL is required");
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker("axial-notifications", async (job) => ingest(job.data), { connection });
  worker.on("error", (error) => console.error("Notifications worker error", error.message));
  const endpoint = process.env.NOTIFICATIONS_PROVIDER_URL,
    token = process.env.NOTIFICATIONS_PROVIDER_TOKEN;
  if (Boolean(endpoint) !== Boolean(token)) throw new Error("Configure both provider URL and token");
  const provider = endpoint && token ? new HttpProvider(endpoint, token) : undefined;
  let busy = false;
  const timer = setInterval(() => {
    if (!provider || busy) return;
    busy = true;
    void dispatchOne(provider)
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
