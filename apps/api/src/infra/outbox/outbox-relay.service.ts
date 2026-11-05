import { randomUUID } from "node:crypto";
import { eventTypes, sourceSchema } from "@axial/contracts";
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { type AppConfig, CONFIG } from "../../common/config.js";
import { PrismaService } from "../database/prisma.service.js";
import { OUTBOX_PUBLISHER, type OutboxEnvelope, type OutboxPublisher } from "./outbox-publisher.js";

interface ClaimedEvent {
  id: string;
  organizationId: string;
  projectId: string | null;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  eventVersion: number;
  actorId: string;
  source: string;
  correlationId: string;
  payload: unknown;
  occurredAt: Date;
  attempts: number;
}

const envelopeDataSchema = z.object({ before: z.unknown(), after: z.unknown() });
const eventTypeSchema = z.enum(eventTypes);

/** Durable at-least-once delivery. Never delete events or mark a partial fanout published. */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<number> | undefined;
  private stopped = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OUTBOX_PUBLISHER) private readonly publisher: OutboxPublisher,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.RELAY_ENABLED) this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  /** One non-overlapping batch. Also usable by deterministic integration tests. */
  flushOnce(): Promise<number> {
    if (this.stopped) return Promise.resolve(0);
    if (this.running) return this.running;
    this.running = this.flush().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      void this.flushOnce()
        .catch(() => this.logger.error("Outbox relay batch failed"))
        .finally(() => {
          if (!this.stopped) this.schedule(this.config.RELAY_POLL_MS);
        });
    }, delay);
    this.timer.unref();
  }

  private async flush(): Promise<number> {
    const lockToken = randomUUID();
    // One atomic statement claims a bounded batch across any number of replicas.
    // Expired leases are eligible again after a crash. Parallel publication keeps the
    // batch comfortably inside the lease; conditional updates fence stale claimants.
    const events = await this.prisma.$queryRaw<ClaimedEvent[]>`
      WITH candidates AS (
        SELECT "id" FROM projects."OutboxEvent"
        WHERE "publishedAt" IS NULL AND "availableAt" <= NOW()
          AND ("lockedUntil" IS NULL OR "lockedUntil" < NOW())
        ORDER BY "occurredAt", "id"
        FOR UPDATE SKIP LOCKED LIMIT 20
      )
      UPDATE projects."OutboxEvent" AS event
      SET "lockedUntil" = NOW() + INTERVAL '60 seconds',
          "lockToken" = ${lockToken}::uuid, "attempts" = event."attempts" + 1
      FROM candidates WHERE event."id" = candidates."id"
      RETURNING event.*
    `;
    const results = await Promise.allSettled(
      events.map(async (event) => {
        try {
          if (event.eventVersion !== 1) throw new Error("Unsupported outbox event version");
          const data = envelopeDataSchema.parse(event.payload);
          const envelope: OutboxEnvelope = {
            id: event.id,
            type: eventTypeSchema.parse(event.eventType),
            version: 1,
            organizationId: event.organizationId,
            projectId: event.projectId,
            actor: { id: event.actorId, source: sourceSchema.parse(event.source) },
            correlationId: event.correlationId,
            aggregate: { type: event.aggregateType, id: event.aggregateId, version: event.aggregateVersion },
            occurredAt: event.occurredAt.toISOString(),
            data,
          };
          await this.publisher.publish(envelope);
          await this.prisma.outboxEvent.updateMany({
            where: { id: event.id, lockToken, publishedAt: null },
            data: { publishedAt: new Date(), lockedUntil: null, lockToken: null, lastError: null },
          });
        } catch {
          // No retry cap discards events. Backoff is bounded; operators can recover a
          // persistent outage without losing the durable event or its attempt count.
          const delayMs = Math.min(15 * 60_000, 1_000 * 2 ** Math.min(event.attempts - 1, 10));
          await this.prisma.outboxEvent.updateMany({
            where: { id: event.id, lockToken, publishedAt: null },
            data: {
              availableAt: new Date(Date.now() + delayMs),
              lockedUntil: null,
              lockToken: null,
              lastError: "Outbox publication failed",
            },
          });
          this.logger.warn(
            JSON.stringify({
              message: "outbox_publication_failed",
              eventId: event.id,
              attempt: event.attempts,
            }),
          );
        }
      }),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Outbox result persistence failed");
    return events.length;
  }
}
