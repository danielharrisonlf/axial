// Painel de desempenho ao vivo: dispara carga real (autocannon) contra a stack local,
// acompanha as métricas nativas dos serviços (/api/v1/metrics) e mostra tudo em uma
// página local. Uso: `pnpm perf:demo` (sobe a stack se ela não estiver no ar).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const pageFile = join(root, "scripts/performance/demo/index.html");
const evidenceDir = join(root, "docs/performance/evidencias");
const lighthouseDir = join(root, "output/validation/performance/lighthouse");
const lighthouseCli = join(root, "node_modules/lighthouse/cli/index.js");
const PORT = Number(process.env.PERF_DEMO_PORT ?? 4900);
const HOST = "127.0.0.1";
const GATEWAY = "http://127.0.0.1:3000";
const API = "http://127.0.0.1:3001";
const GATEWAY_B_PORT = 3100;
const GATEWAY_B = `http://127.0.0.1:${GATEWAY_B_PORT}`;
const WEB = process.env.WEB_URL ?? "http://127.0.0.1:4173";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
mkdirSync(lighthouseDir, { recursive: true });

function portOpen(port) {
  return new Promise((done) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const finish = (value) => {
      socket.destroy();
      done(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

async function waitFor(url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch {}
    await sleep(400);
  }
  return false;
}

function capture(command, args, options = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: root, ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", fail);
    child.once("close", (code) =>
      code === 0 ? done(stdout) : fail(new Error(stderr || stdout || `exit ${code}`)),
    );
  });
}

// ---------------------------------------------------------------- stack e token
async function ensureStack() {
  if ((await portOpen(3000)) && (await portOpen(3001))) return;
  console.log("[demo] stack fora do ar: iniciando com scripts/performance/run.mjs stack");
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, ["scripts/performance/run.mjs", "stack"], {
      cwd: root,
      stdio: "inherit",
    });
    child.once("error", fail);
    child.once("close", (code) => (code === 0 ? done() : fail(new Error(`stack exited ${code}`))));
  });
}

let token = "";
let tokenAt = 0;
let projectId = "";
async function auth() {
  // Tokens de desenvolvimento valem 15 min; renovamos com folga.
  if (token && Date.now() - tokenAt < 10 * 60_000) return token;
  token = (await capture(process.execPath, ["scripts/dev-identity.mjs", "token", "ADMIN"])).trim();
  tokenAt = Date.now();
  if (!projectId) {
    try {
      const body = await fetch(`${API}/api/v1/projects?page=1&pageSize=1`, {
        headers: { authorization: `Bearer ${token}` },
      }).then((response) => response.json());
      projectId = body?.items?.[0]?.id ?? body?.data?.[0]?.id ?? "";
    } catch {}
  }
  return token;
}

// ---------------------------------------------------------------- cenários
const scenarios = {
  "health-gateway": {
    label: "Gateway · health",
    detail: "Rota local do gateway, sem banco: mede o teto do servidor HTTP.",
    base: GATEWAY,
    path: "/api/v1/health/live",
    connections: 100,
  },
  "projects-gateway": {
    label: "Gateway → ms-projects · GET /projects",
    detail: "Caminho real do front: gateway, JWT, Prisma/PostgreSQL e gzip.",
    base: GATEWAY,
    path: "/api/v1/projects?page=1&pageSize=20",
    connections: 50,
  },
  "projects-api": {
    label: "ms-projects direto · GET /projects",
    detail: "Mesma consulta sem o gateway: isola o custo do proxy.",
    base: API,
    path: "/api/v1/projects?page=1&pageSize=20",
    connections: 50,
  },
  "tasks-api": {
    label: "ms-projects · GET /projects/:id/tasks",
    detail: "Listagem mais pesada (relações e payload maior).",
    base: API,
    path: "/api/v1/projects/PROJECT/tasks?page=1&pageSize=20",
    connections: 50,
  },
  "audit-gateway": {
    label: "Gateway → ms-audit · GET /audit",
    detail: "Trilha de auditoria paginada, comprimida com gzip.",
    base: GATEWAY,
    path: "/api/v1/audit?page=1&pageSize=20",
    connections: 30,
  },
  "notifications-gateway": {
    label: "Gateway → ms-notifications · preferências",
    detail: "Preferências de notificação do usuário autenticado.",
    base: GATEWAY,
    path: "/api/v1/notification-preferences",
    connections: 30,
  },
};

// ---------------------------------------------------------------- SSE
const clients = new Set();
function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const response of clients) response.write(data);
}

// ---------------------------------------------------------------- carga
let current = null; // { id, instance, kind }
const history = [];

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10;
}

async function runLoad({ scenarioId, connections, duration, base, series, label }) {
  const scenario = scenarios[scenarioId];
  if (!scenario) throw new Error("Cenário inválido");
  const accessToken = await auth();
  if (scenario.path.includes("PROJECT") && !projectId)
    throw new Error("Nenhum projeto no banco: rode `pnpm db:seed` antes do cenário de tarefas.");
  const url = `${base ?? scenario.base}${scenario.path.replace("PROJECT", projectId)}`;
  const runId = `${Date.now()}`;
  let samples = [];
  let errors = 0;
  let non2xx = 0;
  let second = 0;
  const instance = autocannon({
    url,
    connections,
    duration,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  current = { id: runId, instance };
  broadcast({
    type: "load-start",
    runId,
    series,
    scenarioId,
    label: label ?? scenario.label,
    url,
    connections,
    duration,
  });
  instance.on("response", (_client, statusCode, _bytes, responseTime) => {
    samples.push(responseTime);
    if (statusCode >= 400) non2xx++;
  });
  instance.on("reqError", () => errors++);
  const ticker = setInterval(() => {
    second++;
    const sorted = samples.sort((a, b) => a - b);
    broadcast({
      type: "load-tick",
      runId,
      series,
      second,
      rps: sorted.length,
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
      errors,
      non2xx,
    });
    samples = [];
  }, 1_000);
  const result = await new Promise((done) => instance.once("done", done));
  clearInterval(ticker);
  current = null;
  const summary = {
    runId,
    series,
    scenarioId,
    label: label ?? scenario.label,
    connections,
    duration,
    at: new Date().toISOString(),
    total: result.requests.total,
    throughput: Math.round(result.requests.average),
    p50: result.latency.p50,
    p90: result.latency.p90,
    p99: result.latency.p99,
    max: result.latency.max,
    errors: result.errors + result.timeouts,
    non2xx: result.non2xx,
    kbPerSec: Math.round(result.throughput.average / 1024),
  };
  history.unshift(summary);
  history.length = Math.min(history.length, 30);
  broadcast({ type: "load-done", summary });
  return summary;
}

// ---------------------------------------------------------------- A/B do gateway
let gatewayB = null;
async function startGatewayB() {
  if (await portOpen(GATEWAY_B_PORT)) return;
  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: join(root, "apps/gateway"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      GATEWAY_PORT: String(GATEWAY_B_PORT),
      GATEWAY_UPSTREAM_KEEPALIVE: "false",
      PROJECTS_API_URL: "http://localhost:3001",
      IDENTITY_API_URL: "http://localhost:3002",
      NOTIFICATIONS_API_URL: "http://localhost:3003",
      REALTIME_API_URL: "http://localhost:3004",
      AUDIT_API_URL: "http://localhost:3005",
      MCP_API_URL: "http://localhost:3006",
    },
    stdio: "ignore",
  });
  gatewayB = child;
  child.once("close", () => {
    if (gatewayB === child) gatewayB = null;
  });
  if (!(await waitFor(`${GATEWAY_B}/api/v1/health/live`, 20_000)))
    throw new Error("Gateway B (sem keep-alive) não subiu na porta 3100");
}

async function runAb({ scenarioId = "projects-gateway", connections = 50, duration = 10 }) {
  await startGatewayB();
  broadcast({ type: "ab-start", scenarioId, connections, duration });
  const before = await runLoad({
    scenarioId,
    connections,
    duration,
    base: GATEWAY_B,
    series: "ab-before",
    label: "Sem keep-alive (antes)",
  });
  await sleep(1_500);
  const after = await runLoad({
    scenarioId,
    connections,
    duration,
    base: GATEWAY,
    series: "ab-after",
    label: "Com keep-alive (depois)",
  });
  broadcast({ type: "ab-done", before, after });
}

// ---------------------------------------------------------------- Lighthouse
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const base of [process.env.LOCALAPPDATA, process.env.HOME].filter(Boolean)) {
    try {
      const dir = join(base, "ms-playwright");
      const entries = readdirSync(dir)
        .filter((name) => name.startsWith("chromium-"))
        .sort()
        .reverse();
      for (const entry of entries)
        for (const relative of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux/chrome"]) {
          const candidate = join(dir, entry, relative);
          if (existsSync(candidate)) return candidate;
        }
    } catch {}
  }
  return undefined;
}

let lighthouseRunning = false;
async function runLighthouse(profile) {
  if (lighthouseRunning) throw new Error("Lighthouse já está em execução");
  if (!(await waitFor(`${WEB}/`, 3_000)))
    throw new Error(`Front-end fora do ar em ${WEB} (rode pnpm perf:stack)`);
  lighthouseRunning = true;
  const output = join(lighthouseDir, `demo-${profile}`);
  broadcast({ type: "lighthouse-start", profile });
  const started = Date.now();
  try {
    const chrome = findChrome();
    await capture(
      process.execPath,
      [
        lighthouseCli,
        `${WEB}/#/dashboard`,
        "--quiet",
        "--chrome-flags=--headless=new --no-sandbox",
        ...(profile === "desktop" ? ["--preset=desktop"] : []),
        "--output=json",
        "--output=html",
        `--output-path=${output}`,
        "--only-categories=performance,accessibility,best-practices,seo",
      ],
      { env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) } },
    );
    const report = JSON.parse(readFileSync(`${output}.report.json`, "utf8"));
    const audit = (id) => report.audits[id];
    const result = {
      profile,
      seconds: Math.round((Date.now() - started) / 1000),
      performance: report.categories.performance.score,
      accessibility: report.categories.accessibility?.score,
      bestPractices: report.categories["best-practices"]?.score,
      seo: report.categories.seo?.score,
      fcp: audit("first-contentful-paint").displayValue,
      lcp: audit("largest-contentful-paint").displayValue,
      tbt: audit("total-blocking-time").displayValue,
      cls: audit("cumulative-layout-shift").displayValue,
      speedIndex: audit("speed-index").displayValue,
      totalBytes: audit("total-byte-weight").displayValue,
      report: `/lighthouse/demo-${profile}.report.html`,
    };
    broadcast({ type: "lighthouse-done", result });
    return result;
  } catch (error) {
    broadcast({ type: "lighthouse-error", profile, message: String(error.message).slice(0, 400) });
    throw error;
  } finally {
    lighthouseRunning = false;
  }
}

// ---------------------------------------------------------------- monitor
const monitored = [
  { id: "gateway", label: "Gateway", url: `${GATEWAY}/api/v1/metrics?window=5` },
  { id: "api", label: "ms-projects", url: `${API}/api/v1/metrics?window=5` },
  { id: "gateway-b", label: "Gateway B (sem keep-alive)", url: `${GATEWAY_B}/api/v1/metrics?window=5` },
];
let health = { status: "unknown", services: [] };

async function pollMetrics() {
  const services = {};
  await Promise.all(
    monitored.map(async (service) => {
      if (service.id === "gateway-b" && !gatewayB) return;
      try {
        const snapshot = await fetch(service.url, { signal: AbortSignal.timeout(900) }).then((response) =>
          response.ok ? response.json() : null,
        );
        if (snapshot) services[service.id] = { ...snapshot, routes: snapshot.routes.slice(0, 6) };
      } catch {}
    }),
  );
  broadcast({ type: "metrics", at: Date.now(), services });
}

async function pollHealth() {
  try {
    const response = await fetch(`${GATEWAY}/api/v1/health`, { signal: AbortSignal.timeout(2_500) });
    health = await response.json();
  } catch {
    health = { status: "down", services: [] };
  }
  health.web = await portOpen(4173);
  health.insights = await portOpen(5174);
  broadcast({ type: "health", health });
}

// ---------------------------------------------------------------- HTTP
const types = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function sendFile(response, baseDir, relativePath) {
  const file = normalize(join(baseDir, relativePath));
  if (!file.startsWith(baseDir + sep) || !existsSync(file)) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 10_000) throw new Error("Body too large");
  }
  return body ? JSON.parse(body) : {};
}

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  try {
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": types[".html"], "cache-control": "no-store" });
      response.end(readFileSync(pageFile));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      response.write(
        `data: ${JSON.stringify({ type: "hello", health, history, running: Boolean(current) })}\n\n`,
      );
      clients.add(response);
      request.once("close", () => clients.delete(response));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/scenarios")
      return json(response, 200, { scenarios, projectId: Boolean(projectId) });
    if (request.method === "GET" && url.pathname === "/api/results")
      return json(
        response,
        200,
        JSON.parse(readFileSync(join(root, "docs/performance/resultados.json"), "utf8")),
      );
    if (request.method === "GET" && url.pathname === "/api/prometheus") {
      const target = url.searchParams.get("service") === "api" ? API : GATEWAY;
      const text = await fetch(`${target}/api/v1/metrics/prometheus`).then((r) => r.text());
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(text);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/evidencias/"))
      return sendFile(response, evidenceDir, decodeURIComponent(url.pathname.slice("/evidencias/".length)));
    if (request.method === "GET" && url.pathname.startsWith("/lighthouse/"))
      return sendFile(response, lighthouseDir, decodeURIComponent(url.pathname.slice("/lighthouse/".length)));

    if (request.method === "POST" && url.pathname === "/api/load") {
      if (current) return json(response, 409, { error: "Já existe um teste em execução" });
      const body = await readBody(request);
      const scenario = scenarios[body.scenarioId];
      if (!scenario) return json(response, 400, { error: "Cenário inválido" });
      const options = {
        scenarioId: body.scenarioId,
        connections: clamp(body.connections, 1, 300, scenario.connections),
        duration: clamp(body.duration, 3, 60, 10),
        series: "live",
      };
      runLoad(options).catch((error) => broadcast({ type: "load-error", message: error.message }));
      return json(response, 202, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/ab") {
      if (current) return json(response, 409, { error: "Já existe um teste em execução" });
      const body = await readBody(request);
      runAb({
        scenarioId: scenarios[body.scenarioId] ? body.scenarioId : "projects-gateway",
        connections: clamp(body.connections, 1, 300, 50),
        duration: clamp(body.duration, 3, 30, 10),
      }).catch((error) => broadcast({ type: "load-error", message: error.message }));
      return json(response, 202, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/stop") {
      current?.instance.stop();
      return json(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/lighthouse") {
      const body = await readBody(request);
      const profile = body.profile === "mobile" ? "mobile" : "desktop";
      if (lighthouseRunning) return json(response, 409, { error: "Lighthouse já está em execução" });
      runLighthouse(profile).catch(() => {});
      return json(response, 202, { ok: true });
    }
    response.writeHead(404).end("Not found");
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

// ---------------------------------------------------------------- start
await ensureStack();
try {
  await auth();
} catch (error) {
  console.warn(`[demo] não foi possível gerar o token: ${error.message}`);
}
server.once("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `[demo] a porta ${PORT} já está em uso (o painel já está aberto?). Use PERF_DEMO_PORT para trocar.`
      : `[demo] ${error.message}`,
  );
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const address = `http://${HOST}:${PORT}`;
  console.log(`\n[demo] Painel de desempenho: ${address}`);
  console.log("[demo] Ctrl+C encerra o painel (a stack continua no ar; use pnpm perf:stop para parar).\n");
  if (process.env.PERF_DEMO_NO_OPEN !== "1") {
    const opener =
      process.platform === "win32"
        ? ["cmd", ["/c", "start", "", address]]
        : [process.platform === "darwin" ? "open" : "xdg-open", [address]];
    spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).unref();
  }
});
setInterval(pollMetrics, 1_000).unref();
setInterval(pollHealth, 5_000).unref();
void pollHealth();

for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    current?.instance.stop();
    gatewayB?.kill();
    server.close();
    process.exit(0);
  });
