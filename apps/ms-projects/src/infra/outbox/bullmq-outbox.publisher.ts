import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { type AppConfig, CONFIG } from "../../common/config.js";
import { OUTBOX_QUEUES, type OutboxEnvelope, type OutboxPublisher } from "./outbox-publisher.js";

@Injectable()
export class BullMqOutboxPublisher implements OutboxPublisher, OnApplicationShutdown {
  private readonly logger = new Logger(BullMqOutboxPublisher.name);
  private readonly connection: Redis | undefined;
  private readonly queues: Queue<OutboxEnvelope>[];

  constructor(@Inject(CONFIG) config: AppConfig) {
    if (!config.RELAY_ENABLED) {
      this.queues = [];
      return;
    }
    const connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5_000,
      commandTimeout: 5_000,
      enableOfflineQueue: false,
    });
    this.connection = connection;
    this.connection.on("error", () => this.logger.warn("Redis connection unavailable"));
    this.queues = OUTBOX_QUEUES.map((name) => {
      const queue = new Queue<OutboxEnvelope>(name, { connection });
      queue.on("error", () => this.logger.warn("Outbox queue unavailable"));
      return queue;
    });
  }

  async publish(envelope: OutboxEnvelope): Promise<void> {
    if (this.queues.length !== OUTBOX_QUEUES.length) throw new Error("Outbox publisher is disabled");
    // A stable event ID makes retries after partial fanout harmless while retained jobs exist.
    const results = await Promise.allSettled(
      this.queues.map((queue) =>
        queue.add(envelope.type, envelope, {
          jobId: envelope.id,
          attempts: 10,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: false,
          removeOnFail: false,
        }),
      ),
    );
    if (results.some((result) => result.status === "rejected")) throw new Error("Outbox fanout incomplete");
  }

  async ping(): Promise<void> {
    if (!this.connection || (await this.connection.ping()) !== "PONG") throw new Error("Redis unavailable");
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.queues.map((queue) => queue.close()));
    if (this.connection) {
      try {
        await this.connection.quit();
      } catch {
        this.connection.disconnect();
      }
    }
  }
}
