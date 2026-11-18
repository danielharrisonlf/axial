import { domainEventEnvelopeSchema } from "@axial/contracts";
import type { DemoAuditEvent } from "@axial/demo-fixtures";
import type { Pool } from "pg";

export interface AuditSeedReport {
  /** `already seeded` when an event of the scenario already existed, so nothing was written. */
  status: "seeded" | "already seeded";
  /** Events written by this run; zero on a repeated run. */
  inserted: number;
  /** Events of the scenario present after the run, counted by id. */
  present: number;
  /** Divergences from the scenario (events missing after the run); never fatal. */
  warnings: string[];
}

/**
 * Writes the history of the demonstration scenario into audit.events on the first run only, in
 * one transaction under an advisory lock, by deterministic event id (`ON CONFLICT (id) DO NOTHING`,
 * the same rule as duplicate deliveries). The transaction is all or nothing, so any scenario event
 * present means an earlier run committed the whole history: the run then writes nothing and events
 * removed since are not restored. Every event passes the envelope contract the consumer enforces.
 * A shortfall is reported in `warnings` without failing; database errors still fail the seed.
 */
export async function seedAuditEvents(pool: Pool, events: DemoAuditEvent[]): Promise<AuditSeedReport> {
  const envelopes = events.map(({ legacyId: _legacyId, ...event }) => domainEventEnvelopeSchema.parse(event));
  const ids = envelopes.map((event) => event.id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('axial-audit-demo-seed'))");
    const count = async () =>
      Number(
        (
          await client.query<{ count: string }>(
            "SELECT count(*) FROM audit.events WHERE id = ANY($1::uuid[])",
            [ids],
          )
        ).rows[0]?.count ?? 0,
      );
    const seeded = (await count()) > 0;
    let inserted = 0;
    if (!seeded)
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
    const present = await count();
    const warnings =
      present < ids.length
        ? [`events: ${present} of ${ids.length} scenario events present; missing events are not restored`]
        : [];
    await client.query("COMMIT");
    return { status: seeded ? "already seeded" : "seeded", inserted, present, warnings };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
