import { type DomainEventEnvelope, EVENT_DESTINATIONS } from "@axial/contracts";

export const OUTBOX_PUBLISHER = Symbol("OUTBOX_PUBLISHER");
export const OUTBOX_QUEUES = EVENT_DESTINATIONS;
export type OutboxEnvelope = DomainEventEnvelope;

/** Publication is at least once; consumers must deduplicate by envelope.id. */
export interface OutboxPublisher {
  publish(envelope: OutboxEnvelope): Promise<void>;
  ping(): Promise<void>;
}
