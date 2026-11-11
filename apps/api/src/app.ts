import "reflect-metadata";
import { createMetrics } from "@axial/observability";
import { ConsoleLogger, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { readConfig } from "./common/config.js";
import { ObserveInstrument, observeEnabled } from "./infra/observe.js";

export function createOpenApi(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Axial - ms-projects")
      .setDescription("Projetos, epicos, tarefas, sprints e cronogramas. Identidade externa via JWT RS256.")
      .setVersion("1.0.0")
      .addBearerAuth()
      .build(),
  );
}

/** Creates and initializes the HTTP application without binding a network port. */
export async function createApp(): Promise<INestApplication> {
  const config = readConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: config.NODE_ENV === "test" ? false : new ConsoleLogger({ json: true }),
    ...(observeEnabled ? { instrument: ObserveInstrument } : {}),
  });
  // Native HTTP/runtime metrics: GET /api/v1/metrics (JSON) and /api/v1/metrics/prometheus.
  const metrics = createMetrics({
    service: "ms-projects",
    ignore: ["/api/v1/metrics", "/api/v1/health"],
    info: () => ({ nestjsObserve: observeEnabled ? "enabled" : "disabled" }),
  });
  app.use(metrics.middleware);
  app.use("/api/v1/metrics", metrics.handler);
  app.use(helmet());
  app.use(compression({ threshold: 1024 }));
  app.useBodyParser("json", { limit: "256kb" });
  app.setGlobalPrefix("api/v1");
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: false });
  app.enableShutdownHooks();
  if (config.NODE_ENV !== "production") {
    SwaggerModule.setup("docs", app, createOpenApi(app), { jsonDocumentUrl: "docs/openapi.json" });
  }
  try {
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
