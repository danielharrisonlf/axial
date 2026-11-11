import { createObserveModule } from "@nestjs/observe";

/**
 * NestJS Observe (the official observability SDK released with NestJS 12) reports
 * requests, provider spans, pg queries and errors to the hosted dashboard at
 * observe.nestjs.com. It is opt-in: it only turns on when both credentials are set,
 * so local runs, tests and performance measurements are not affected by default.
 */
export const observeEnabled = Boolean(process.env.OBSERVE_APP_KEY && process.env.OBSERVE_APP_SECRET);

// Source context would ship snippets of the application's source with each error.
export const { ObserveModule, ObserveInstrument } = createObserveModule({ sourceContext: false });

export const observeModule = ObserveModule.forRoot({
  serviceId: process.env.OBSERVE_SERVICE_ID ?? "axial-ms-projects",
  enabled: observeEnabled,
  // Expected outcomes (auth and not-found) are reported without their span tree.
  skipSpans: [400, 401, 403, 404],
});
