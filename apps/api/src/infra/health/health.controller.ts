import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../../common/auth/public.decorator.js";
import { type AppConfig, CONFIG } from "../../common/config.js";
import { PrismaService } from "../database/prisma.service.js";
import { OUTBOX_PUBLISHER, type OutboxPublisher } from "../outbox/outbox-publisher.js";

@Public()
@Controller("health")
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OUTBOX_PUBLISHER) private readonly publisher: OutboxPublisher,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(): Promise<{ status: "ok" }> {
    try {
      await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        ...(this.config.RELAY_ENABLED ? [this.publisher.ping()] : []),
      ]);
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException("Service dependencies unavailable");
    }
  }
}
