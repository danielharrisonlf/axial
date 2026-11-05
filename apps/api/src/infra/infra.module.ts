import { Global, type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { JwtAuthGuard } from "../common/auth/jwt-auth.guard.js";
import { CONFIG, readConfig } from "../common/config.js";
import { HttpExceptionFilter } from "../common/http-exception.filter.js";
import { RequestContextMiddleware } from "../common/request-context.middleware.js";
import { PrismaService } from "./database/prisma.service.js";
import { HealthController } from "./health/health.controller.js";
import { BullMqOutboxPublisher } from "./outbox/bullmq-outbox.publisher.js";
import { OUTBOX_PUBLISHER } from "./outbox/outbox-publisher.js";
import { OutboxRelayService } from "./outbox/outbox-relay.service.js";

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: CONFIG, useFactory: readConfig },
    PrismaService,
    BullMqOutboxPublisher,
    { provide: OUTBOX_PUBLISHER, useExisting: BullMqOutboxPublisher },
    OutboxRelayService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
  exports: [CONFIG, PrismaService, OutboxRelayService, OUTBOX_PUBLISHER],
})
export class InfrastructureModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("{*path}");
  }
}
