import { domainEventEnvelopeSchema } from "@axial/contracts";
import type { DemoAuditEvent } from "@axial/demo-fixtures";
import type { Pool } from "pg";

export interface AuditSeedReport {
  /** Events written by this run; zero on a repeated run. */
  inserted: number;
  /** Events of the scenario present after the run. */
  present: number;
}

/**
 * Writes the history of the demonstration scenario into audit.events, insert only and
 * idempotent by deterministic event id (`ON CONFLICT (id) DO NOTHING`, the same rule as
 * duplicate deliveries). Every event passes the envelope contract the consumer enforces.
 */
export async function seedAuditEvents(pool: Pool, events: DemoAuditEvent[]): Promise<AuditSeedReport> {
  const envelopes = events.map(({ legacyId: _legacyId, ...event }) => domainEventEnvelopeSchema.parse(event));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    for (const event of envelopes) {
      const result = await client.query(
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
          JSON.stringify(event.data),
        ],
      );
      inserted += result.rowCount ?? 0;
    }
    const present = await client.query<{ count: string }>(
      "SELECT count(*) FROM audit.events WHERE id = ANY($1::uuid[])",
      [envelopes.map((event) => event.id)],
    );
    await client.query("COMMIT");
    return { inserted, present: Number(present.rows[0]?.count ?? 0) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
