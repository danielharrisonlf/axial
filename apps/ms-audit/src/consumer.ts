import { domainEventEnvelopeSchema } from "@axial/contracts";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { db } from "./db.js";

/** Records one domain event. Duplicate deliveries are ignored by primary key. */
export async function ingest(value: unknown): Promise<void> {
  const event = domainEventEnvelopeSchema.parse(value);
  await db.query(
    `INSERT INTO audit.events(
       id,organization_id,project_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       actor_id,actor_source,correlation_id,occurred_at,data
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO NOTHING`,
    [
      event.id,
      event.organizationId,
      event.projectId,
      event.type,
      event.aggregate.type,
      event.aggregate.id,
      event.aggregate.version,
      event.actor.id,
      event.actor.source,
      event.correlationId,
      event.occurredAt,
      JSON.stringify(event.data ?? {}),
    ],
  );
}

export interface Consumer {
  ready: () => Promise<boolean>;
  close: () => Promise<void>;
}

export function startConsumer(): Consumer {
  const redisUrl = process.env.AUDIT_REDIS_URL;
  if (!redisUrl) throw new Error("AUDIT_REDIS_URL is required");
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker("axial-audit", async (job) => ingest(job.data), { connection });
  worker.on("error", (error) => console.error("Audit worker error", error.message));
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
      await worker.close();
      await connection.quit();
    },
  };
}
