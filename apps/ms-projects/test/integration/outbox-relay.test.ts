import { Queue } from "bullmq";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readConfig } from "../../src/common/config.js";
import { PrismaService } from "../../src/infra/database/prisma.service.js";
import { BullMqOutboxPublisher } from "../../src/infra/outbox/bullmq-outbox.publisher.js";
import {
  OUTBOX_QUEUES,
  type OutboxEnvelope,
  type OutboxPublisher,
} from "../../src/infra/outbox/outbox-publisher.js";
import { OutboxRelayService } from "../../src/infra/outbox/outbox-relay.service.js";
import { startTestApp, uuid } from "../support/app-harness.js";

describe("durable outbox relay", () => {
  let prisma: PrismaService;
  let redisUrl: string;
  let publisher: BullMqOutboxPublisher;
  let queues: Queue<OutboxEnvelope>[];
  let eventId: string | undefined;
  let eventIds: string[] = [];
  let appHarness: Awaited<ReturnType<typeof startTestApp>>;
  const queueAt = (index: number): Queue<OutboxEnvelope> => {
    const queue = queues[index];
    if (!queue) throw new Error(`Missing test queue at index ${index}`);
    return queue;
  };

  beforeAll(async () => {
    appHarness = await startTestApp();
    prisma = appHarness.app.get(PrismaService);
    redisUrl = process.env.TEST_REDIS_URL ?? readConfig().REDIS_URL;
    queues = OUTBOX_QUEUES.map((name) => new Queue<OutboxEnvelope>(name, { connection: { url: redisUrl } }));
    publisher = new BullMqOutboxPublisher({ ...readConfig(), RELAY_ENABLED: true });
    await Promise.all(queues.map((queue) => queue.waitUntilReady()));
    await vi.waitFor(() => publisher.ping(), { timeout: 5_000 });
  }, 30_000);

  afterEach(async () => {
    if (eventId) eventIds.push(eventId);
    await prisma.outboxEvent.deleteMany({ where: { id: { in: eventIds } } });
    await Promise.all(
      queues.flatMap((queue) =>
        eventIds.map(async (id) => {
          const job = await queue.getJob(id);
          if (job) await job.remove();
        }),
      ),
    );
    eventId = undefined;
    eventIds = [];
  });

  afterAll(async () => {
    await Promise.allSettled(queues?.map((queue) => queue.close()) ?? []);
    await publisher?.onApplicationShutdown();
    await appHarness?.close();
  });

  it("retries a failed publication, then atomically fans the same durable event out to all three queues", async () => {
    eventId = uuid();
    const actorId = uuid();
    const organizationId = uuid();
    const aggregateId = uuid();
    await prisma.outboxEvent.create({
      data: {
        id: eventId,
        organizationId,
        projectId: null,
        aggregateType: "Task",
        aggregateId,
        aggregateVersion: 1,
        eventType: "task.created",
        eventVersion: 1,
        actorId,
        source: "api",
        correlationId: uuid(),
        payload: { before: null, after: { id: aggregateId, title: "relay acceptance event" } },
      },
    });

    const failingPublisher: OutboxPublisher = {
      async publish(envelope: OutboxEnvelope) {
        await queueAt(0).add(envelope.type, envelope, { jobId: envelope.id, removeOnComplete: false });
        throw new Error("simulated partial fanout outage after first queue accepted");
      },
      async ping() {
        return;
      },
    };
    const failingRelay = new OutboxRelayService(prisma, failingPublisher, {
      ...readConfig(),
      RELAY_ENABLED: false,
    });
    await failingRelay.flushOnce();
    const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(failed.attempts).toBe(1);
    expect(failed.publishedAt).toBeNull();
    expect(failed.lockToken).toBeNull();
    expect(failed.lockedUntil).toBeNull();
    expect(failed.lastError).toBe("Outbox publication failed");
    expect(await queueAt(0).getJob(eventId)).toBeDefined();
    expect(await queueAt(1).getJob(eventId)).toBeUndefined();

    // Make only this test event eligible again; no table-wide reset or migration is performed.
    await prisma.outboxEvent.update({
      where: { id: eventId },
      data: { availableAt: new Date(Date.now() - 1_000) },
    });
    const relay = new OutboxRelayService(prisma, publisher, { ...readConfig(), RELAY_ENABLED: false });
    await relay.flushOnce();

    const published = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(published.attempts).toBe(2);
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(published.lastError).toBeNull();
    for (const queue of queues) {
      const job = await queue.getJob(eventId);
      expect(job).toBeDefined();
      expect(job?.data).toMatchObject({
        id: eventId,
        type: "task.created",
        organizationId,
        aggregate: { type: "Task", id: aggregateId, version: 1 },
        actor: { id: actorId, source: "api" },
        data: { before: null, after: { id: aggregateId, title: "relay acceptance event" } },
      });
      expect(job?.id).toBe(eventId);
    }
    // Replaying an already fanned-out durable envelope retains one job per destination.
    const durableJob = await queueAt(0).getJob(eventId);
    if (!durableJob) throw new Error("Published event was not retained in Redis");
    await publisher.publish(durableJob.data);
    for (const queue of queues) {
      expect(
        (await queue.getJobs(["wait", "delayed", "active", "completed", "failed"])).filter(
          (job) => job.id === eventId,
        ),
      ).toHaveLength(1);
    }
  }, 30_000);

  async function insertEvent(extra: Record<string, unknown> = {}) {
    const id = uuid();
    eventIds.push(id);
    await prisma.outboxEvent.create({
      data: {
        id,
        organizationId: uuid(),
        aggregateType: "task",
        aggregateId: uuid(),
        aggregateVersion: 1,
        eventType: "task.created",
        actorId: uuid(),
        source: "api",
        correlationId: uuid(),
        payload: { before: null, after: { title: "Concurrent relay acceptance" } },
        ...extra,
      },
    });
    return id;
  }

  it("allows two relay instances to claim disjoint batches while the first publisher is still pending", async () => {
    for (let index = 0; index < 24; index++) await insertEvent();
    const delivered: string[] = [];
    let release!: () => void;
    let claimed!: () => void;
    const claimedSignal = new Promise<void>((resolve) => {
      claimed = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowPublisher: OutboxPublisher = {
      async ping() {},
      async publish(envelope) {
        delivered.push(envelope.id);
        claimed();
        await pending;
      },
    };
    const quickPublisher: OutboxPublisher = {
      async ping() {},
      async publish(envelope) {
        delivered.push(envelope.id);
      },
    };
    const first = new OutboxRelayService(prisma, slowPublisher, { ...readConfig(), RELAY_ENABLED: false });
    const second = new OutboxRelayService(prisma, quickPublisher, { ...readConfig(), RELAY_ENABLED: false });
    const firstBatch = first.flushOnce();
    try {
      await claimedSignal;
      expect(await second.flushOnce()).toBe(4);
    } finally {
      release();
      await firstBatch;
    }
    expect(delivered).toHaveLength(24);
    expect(new Set(delivered).size).toBe(24);
    expect(
      await prisma.outboxEvent.count({
        where: { id: { in: eventIds }, publishedAt: { not: null }, attempts: 1 },
      }),
    ).toBe(24);
  });

  it("reclaims an expired lease but leaves a current lease untouched", async () => {
    const expired = await insertEvent({
      lockedUntil: new Date(Date.now() - 1_000),
      lockToken: uuid(),
      attempts: 1,
    });
    const current = await insertEvent({
      lockedUntil: new Date(Date.now() + 60_000),
      lockToken: uuid(),
      attempts: 1,
    });
    const delivered: string[] = [];
    const recorder: OutboxPublisher = {
      async ping() {},
      async publish(envelope) {
        delivered.push(envelope.id);
      },
    };
    const relay = new OutboxRelayService(prisma, recorder, { ...readConfig(), RELAY_ENABLED: false });
    await relay.flushOnce();
    expect(delivered).toEqual([expired]);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: expired } })).toMatchObject({
      attempts: 2,
      lockToken: null,
      lockedUntil: null,
    });
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: current } })).publishedAt).toBeNull();
  });
});
