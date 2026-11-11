import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";

/**
 * Upper bounds (ms) of the latency histogram buckets. A fixed log-like scale keeps
 * recording O(1) and memory constant regardless of traffic.
 */
export const LATENCY_BOUNDS_MS = [
  1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000,
] as const;
const BUCKETS = LATENCY_BOUNDS_MS.length + 1;
const WINDOW_SLOTS = 60;
const MAX_ROUTES = 200;

interface Slot {
  second: number;
  count: number;
  errors: number;
  sum: number;
  hist: Uint32Array;
}

interface RouteStats {
  count: number;
  errors: number;
  sum: number;
  hist: Uint32Array;
  statuses: Record<string, number>;
}

export interface LatencySummary {
  requests: number;
  errors: number;
  rps: number;
  errorRate: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricsSnapshot {
  service: string;
  pid: number;
  node: string;
  uptimeSec: number;
  collectedAt: string;
  inFlight: number;
  window: LatencySummary & { seconds: number };
  totals: { requests: number; errors: number };
  process: {
    cpuPercent: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    eventLoop: { p50: number; p99: number; max: number; utilization: number };
  };
  routes: (LatencySummary & { route: string })[];
  series: { t: number; rps: number; p95: number; errors: number }[];
  info: Record<string, unknown>;
}

export interface MetricsOptions {
  /** Service name reported in the snapshot and in Prometheus labels. */
  service: string;
  /** Paths (prefix match) that are not recorded, e.g. the metrics endpoint itself. */
  ignore?: string[];
  /** Custom route label; defaults to `METHOD /normalized/path`. */
  label?: (request: IncomingMessage) => string;
  /** Extra service information merged into the JSON snapshot. */
  info?: () => Record<string, unknown>;
  /**
   * Bearer token required to read the endpoint. Defaults to METRICS_TOKEN.
   * Without a token, the endpoint is disabled when NODE_ENV=production.
   */
  token?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_LIKE = /^(\d+|[0-9a-f]{16,}|[A-Za-z0-9_-]{21,})$/;

/** Replaces identifiers in a path so that metrics are grouped per route, not per resource. */
export function normalizePath(url: string): string {
  const path = url.split("?")[0] ?? "/";
  return (
    path
      .split("/")
      .map((segment) => (UUID.test(segment) || ID_LIKE.test(segment) ? ":id" : segment))
      .join("/") || "/"
  );
}

function bucketIndex(ms: number): number {
  for (let index = 0; index < LATENCY_BOUNDS_MS.length; index++)
    if (ms <= (LATENCY_BOUNDS_MS[index] as number)) return index;
  return LATENCY_BOUNDS_MS.length;
}

/** Percentile from a bucketed histogram, linearly interpolated inside the bucket. */
export function percentile(hist: Uint32Array, total: number, p: number): number {
  if (total === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * total));
  let seen = 0;
  for (let index = 0; index < hist.length; index++) {
    const count = hist[index] as number;
    if (count === 0) continue;
    if (seen + count >= rank) {
      const lower = index === 0 ? 0 : (LATENCY_BOUNDS_MS[index - 1] as number);
      const upper = (LATENCY_BOUNDS_MS[index] as number | undefined) ?? lower * 2;
      return round(lower + ((rank - seen) / count) * (upper - lower));
    }
    seen += count;
  }
  return LATENCY_BOUNDS_MS[LATENCY_BOUNDS_MS.length - 1] as number;
}

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const mb = (bytes: number) => round(bytes / 1024 / 1024);

function summarize(count: number, errors: number, sum: number, hist: Uint32Array, seconds: number) {
  return {
    requests: count,
    errors,
    rps: round(count / Math.max(seconds, 1)),
    errorRate: count ? round((errors / count) * 100, 2) : 0,
    avg: count ? round(sum / count) : 0,
    p50: percentile(hist, count, 50),
    p95: percentile(hist, count, 95),
    p99: percentile(hist, count, 99),
  };
}

export class HttpMetrics {
  private readonly slots: Slot[] = Array.from({ length: WINDOW_SLOTS }, () => ({
    second: -1,
    count: 0,
    errors: 0,
    sum: 0,
    hist: new Uint32Array(BUCKETS),
  }));
  private readonly routes = new Map<string, RouteStats>();
  private readonly startedAt = Date.now();
  private totalRequests = 0;
  private totalErrors = 0;
  private inFlight = 0;
  // Event loop lag is probed with setImmediate rather than monitorEventLoopDelay:
  // the latter rides on timers, whose ~15.6 ms granularity on Windows would be
  // reported as lag even on an idle process.
  private lagSamples: number[] = [];
  private readonly probe: NodeJS.Timeout;
  private loopStats = { p50: 0, p99: 0, max: 0 };
  private elu = performance.eventLoopUtilization();
  private eluPercent = 0;
  private cpu = process.cpuUsage();
  private cpuAt = process.hrtime.bigint();
  private cpuPercent = 0;
  private readonly timer: NodeJS.Timeout;
  private readonly token: string | undefined;
  private readonly exposed: boolean;

  constructor(private readonly options: MetricsOptions) {
    this.token = options.token ?? (process.env.METRICS_TOKEN || undefined);
    this.exposed = Boolean(this.token) || process.env.NODE_ENV !== "production";
    this.probe = setInterval(() => {
      const scheduled = performance.now();
      setImmediate(() => this.lagSamples.push(performance.now() - scheduled));
    }, 50);
    this.probe.unref();
    // Runtime gauges are sampled once per second so that several readers do not
    // reset each other's windows.
    this.timer = setInterval(() => this.sampleRuntime(), 1_000);
    this.timer.unref();
  }

  /** Express/Connect compatible middleware that times every request. */
  readonly middleware = (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    const url = request.url ?? "/";
    if (this.options.ignore?.some((prefix) => url.startsWith(prefix))) {
      next();
      return;
    }
    const started = process.hrtime.bigint();
    this.inFlight++;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.inFlight--;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      // A connection closed before the response finished is reported as 499.
      const status = response.writableFinished ? response.statusCode : 499;
      this.record(this.options.label?.(request) ?? `${request.method} ${normalizePath(url)}`, status, ms);
    };
    response.once("finish", finish);
    response.once("close", finish);
    next();
  };

  /** Records one request; exposed for non-HTTP adapters and tests. */
  record(route: string, status: number, ms: number, now = Date.now()): void {
    const second = Math.floor(now / 1000);
    const slot = this.slots[second % WINDOW_SLOTS] as Slot;
    if (slot.second !== second) {
      slot.second = second;
      slot.count = 0;
      slot.errors = 0;
      slot.sum = 0;
      slot.hist.fill(0);
    }
    const isError = status >= 500;
    const index = bucketIndex(ms);
    slot.count++;
    slot.sum += ms;
    slot.hist[index] = (slot.hist[index] as number) + 1;
    if (isError) slot.errors++;
    this.totalRequests++;
    if (isError) this.totalErrors++;

    const key = this.routes.has(route) || this.routes.size < MAX_ROUTES ? route : "other";
    let stats = this.routes.get(key);
    if (!stats) {
      stats = { count: 0, errors: 0, sum: 0, hist: new Uint32Array(BUCKETS), statuses: {} };
      this.routes.set(key, stats);
    }
    stats.count++;
    stats.sum += ms;
    stats.hist[index] = (stats.hist[index] as number) + 1;
    if (isError) stats.errors++;
    const statusClass = `${Math.floor(status / 100)}xx`;
    stats.statuses[statusClass] = (stats.statuses[statusClass] ?? 0) + 1;
  }

  private sampleRuntime(): void {
    const now = process.hrtime.bigint();
    const usage = process.cpuUsage(this.cpu);
    const elapsedUs = Number(now - this.cpuAt) / 1e3;
    this.cpuPercent = elapsedUs > 0 ? round(((usage.user + usage.system) / elapsedUs) * 100) : 0;
    this.cpu = process.cpuUsage();
    this.cpuAt = now;
    const elu = performance.eventLoopUtilization(this.elu);
    this.eluPercent = round(elu.utilization * 100);
    this.elu = performance.eventLoopUtilization();
    const lags = this.lagSamples.sort((a, b) => a - b);
    const at = (q: number) => lags[Math.min(lags.length - 1, Math.floor(q * lags.length))] ?? 0;
    this.loopStats = { p50: round(at(0.5), 2), p99: round(at(0.99), 2), max: round(lags.at(-1) ?? 0, 2) };
    this.lagSamples = [];
  }

  snapshot(windowSeconds = 10, now = Date.now()): MetricsSnapshot {
    const current = Math.floor(now / 1000);
    const uptime = (now - this.startedAt) / 1000;
    const seconds = Math.max(1, Math.min(Math.floor(windowSeconds), WINDOW_SLOTS - 1));
    // Right after start-up the window is not full yet; divide by the time actually covered.
    const covered = Math.max(1, Math.min(seconds, Math.floor(uptime)));
    const hist = new Uint32Array(BUCKETS);
    let count = 0;
    let errors = 0;
    let sum = 0;
    const series: MetricsSnapshot["series"] = [];
    for (let back = WINDOW_SLOTS - 1; back >= 0; back--) {
      const second = current - back;
      const slot = this.slots[second % WINDOW_SLOTS] as Slot;
      const live = slot.second === second;
      series.push({
        t: second * 1000,
        rps: live ? slot.count : 0,
        p95: live ? percentile(slot.hist, slot.count, 95) : 0,
        errors: live ? slot.errors : 0,
      });
      // The current second is still filling up; the window uses complete seconds.
      if (!live || back === 0 || back > seconds) continue;
      count += slot.count;
      errors += slot.errors;
      sum += slot.sum;
      for (let index = 0; index < BUCKETS; index++)
        hist[index] = (hist[index] as number) + (slot.hist[index] as number);
    }
    const memory = process.memoryUsage();
    return {
      service: this.options.service,
      pid: process.pid,
      node: process.version,
      uptimeSec: Math.round(uptime),
      collectedAt: new Date(now).toISOString(),
      inFlight: this.inFlight,
      window: { seconds, ...summarize(count, errors, sum, hist, covered) },
      totals: { requests: this.totalRequests, errors: this.totalErrors },
      process: {
        cpuPercent: this.cpuPercent,
        rssMb: mb(memory.rss),
        heapUsedMb: mb(memory.heapUsed),
        heapTotalMb: mb(memory.heapTotal),
        eventLoop: { ...this.loopStats, utilization: this.eluPercent },
      },
      routes: [...this.routes.entries()]
        .map(([route, stats]) => ({
          route,
          ...summarize(stats.count, stats.errors, stats.sum, stats.hist, uptime),
        }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 25),
      series,
      info: this.options.info?.() ?? {},
    };
  }

  /** Prometheus text exposition format (version 0.0.4). */
  prometheus(): string {
    const service = this.options.service.replace(/["\\\n]/g, "_");
    const escapeLabel = (value: string) =>
      value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
    const lines = [
      "# HELP http_requests_total Requests handled, by route and status class.",
      "# TYPE http_requests_total counter",
    ];
    for (const [route, stats] of this.routes)
      for (const [statusClass, value] of Object.entries(stats.statuses))
        lines.push(
          `http_requests_total{service="${service}",route="${escapeLabel(route)}",status="${statusClass}"} ${value}`,
        );
    lines.push(
      "# HELP http_request_duration_ms Request duration in milliseconds.",
      "# TYPE http_request_duration_ms histogram",
    );
    for (const [route, stats] of this.routes) {
      const labels = `service="${service}",route="${escapeLabel(route)}"`;
      let cumulative = 0;
      LATENCY_BOUNDS_MS.forEach((bound, index) => {
        cumulative += stats.hist[index] as number;
        lines.push(`http_request_duration_ms_bucket{${labels},le="${bound}"} ${cumulative}`);
      });
      lines.push(`http_request_duration_ms_bucket{${labels},le="+Inf"} ${stats.count}`);
      lines.push(`http_request_duration_ms_sum{${labels}} ${round(stats.sum, 3)}`);
      lines.push(`http_request_duration_ms_count{${labels}} ${stats.count}`);
    }
    const snapshot = this.snapshot();
    const gauge = (name: string, help: string, value: number) =>
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name}{service="${service}"} ${value}`);
    gauge("http_requests_in_flight", "Requests currently being handled.", snapshot.inFlight);
    gauge(
      "process_cpu_percent",
      "CPU used by the process (percent of one core).",
      snapshot.process.cpuPercent,
    );
    gauge(
      "process_resident_memory_bytes",
      "Resident set size.",
      Math.round(snapshot.process.rssMb * 1048576),
    );
    gauge("nodejs_heap_used_bytes", "V8 heap in use.", Math.round(snapshot.process.heapUsedMb * 1048576));
    gauge(
      "nodejs_eventloop_lag_p99_ms",
      "Event loop delay p99 (last second).",
      snapshot.process.eventLoop.p99,
    );
    gauge(
      "nodejs_eventloop_utilization_percent",
      "Event loop utilization (last second).",
      snapshot.process.eventLoop.utilization,
    );
    return `${lines.join("\n")}\n`;
  }

  /**
   * Request handler for the metrics endpoint. Mounted at a path, it serves JSON at
   * the root and the Prometheus format at `/prometheus`.
   */
  readonly handler = (request: IncomingMessage, response: ServerResponse): void => {
    if (!this.exposed) {
      response.writeHead(404).end();
      return;
    }
    if (this.token && request.headers.authorization !== `Bearer ${this.token}`) {
      response.writeHead(401, { "content-type": "application/json" }).end('{"error":"Unauthorized"}');
      return;
    }
    const url = new URL(request.url ?? "/", "http://metrics.local");
    const headers = { "cache-control": "no-store" };
    if (url.pathname.endsWith("/prometheus")) {
      response
        .writeHead(200, { ...headers, "content-type": "text/plain; version=0.0.4; charset=utf-8" })
        .end(this.prometheus());
      return;
    }
    const windowSeconds = Number(url.searchParams.get("window") ?? 10);
    response
      .writeHead(200, { ...headers, "content-type": "application/json; charset=utf-8" })
      .end(JSON.stringify(this.snapshot(Number.isFinite(windowSeconds) ? windowSeconds : 10)));
  };

  close(): void {
    clearInterval(this.timer);
    clearInterval(this.probe);
  }
}

export function createMetrics(options: MetricsOptions): HttpMetrics {
  return new HttpMetrics(options);
}
