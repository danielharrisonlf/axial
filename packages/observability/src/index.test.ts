import { afterEach, describe, expect, it } from "vitest";
import { HttpMetrics, normalizePath, percentile } from "./index.js";

describe("normalizePath", () => {
  it("groups identifiers into a route template", () => {
    expect(normalizePath("/api/v1/projects/0193a1b2-7c3d-7e4f-8a9b-0c1d2e3f4a5b/tasks?page=2")).toBe(
      "/api/v1/projects/:id/tasks",
    );
    expect(normalizePath("/api/v1/tasks/42")).toBe("/api/v1/tasks/:id");
    expect(normalizePath("/api/v1/health/live")).toBe("/api/v1/health/live");
  });
});

describe("percentile", () => {
  it("returns 0 without samples", () => {
    expect(percentile(new Uint32Array(24), 0, 99)).toBe(0);
  });
});

describe("HttpMetrics", () => {
  let metrics: HttpMetrics | undefined;
  afterEach(() => metrics?.close());

  it("summarizes the complete seconds of the window", () => {
    metrics = new HttpMetrics({ service: "test" });
    const now = Date.now();
    const base = Math.floor(now / 1000) * 1000 - 3000;
    for (let index = 0; index < 90; index++) metrics.record("GET /a", 200, 8, base);
    for (let index = 0; index < 10; index++) metrics.record("GET /a", 503, 400, base + 1000);
    const snapshot = metrics.snapshot(10, now);
    expect(snapshot.window.requests).toBe(100);
    expect(snapshot.window.errors).toBe(10);
    expect(snapshot.window.errorRate).toBe(10);
    expect(snapshot.window.p50).toBeGreaterThan(7);
    expect(snapshot.window.p50).toBeLessThanOrEqual(10);
    expect(snapshot.window.p99).toBeGreaterThan(300);
    expect(snapshot.routes[0]).toMatchObject({ route: "GET /a", requests: 100, errors: 10 });
    expect(snapshot.series).toHaveLength(60);
  });

  it("exports Prometheus counters and histograms", () => {
    metrics = new HttpMetrics({ service: "test" });
    metrics.record('GET /"quoted"', 200, 12);
    const text = metrics.prometheus();
    expect(text).toContain('http_requests_total{service="test",route="GET /\\"quoted\\"",status="2xx"} 1');
    expect(text).toContain(
      'http_request_duration_ms_bucket{service="test",route="GET /\\"quoted\\"",le="+Inf"} 1',
    );
    expect(text).toContain("nodejs_eventloop_lag_p99_ms");
  });
});
