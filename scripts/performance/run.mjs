import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const perfDir = join(root, "output/validation/performance");
const docsDir = join(root, "docs/performance");
const logsDir = join(perfDir, "logs");
const rawDir = join(perfDir, "raw");
const lighthouseDir = join(perfDir, "lighthouse");
const vitalsDir = join(perfDir, "vitals");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const autocannonCli = join(root, "node_modules/autocannon/autocannon.js");
const lighthouseCli = join(root, "node_modules/lighthouse/cli/index.js");

for (const dir of [
  perfDir,
  logsDir,
  rawDir,
  lighthouseDir,
  vitalsDir,
  docsDir,
  join(docsDir, "evidencias"),
  join(docsDir, "evidencias/load"),
])
  mkdirSync(dir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, { cwd = root, env = process.env, capture = false } = {}) {
  const child = spawn(command, args, {
    cwd,
    env,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  let stdout = "";
  let stderr = "";
  if (capture) {
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
  }
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stderr || stdout}`));
    });
  });
}

async function portOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const done = (value) => {
      socket.destroy();
      resolvePromise(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(500, () => done(false));
  });
}

function killPort(port) {
  if (process.platform === "win32") {
    const output = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" }).stdout ?? "";
    for (const line of output.split("\n")) {
      const match = line.match(new RegExp(`:${port}\\s+.*LISTENING\\s+(\\d+)`));
      if (match) spawnSync("taskkill", ["/PID", match[1], "/T", "/F"], { stdio: "ignore" });
    }
  } else {
    spawnSync("sh", ["-c", `lsof -ti:${port} | xargs -r kill -9`], { stdio: "ignore" });
  }
}

async function waitFor(url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {}
    await sleep(400);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

const db = process.env.PERF_DATABASE_URL ?? "postgresql://axial:axial_local_only@localhost:5549/axial_dev";
const redis = process.env.PERF_REDIS_URL ?? "redis://localhost:6389";
const keys = "../../keys";
const baseEnv = { ...process.env, NODE_ENV: "development" };

const services = [
  { name: "api", port: 3001, cwd: "apps/api", args: ["dist/main.js"], env: {} },
  {
    name: "ms-identity",
    port: 3002,
    cwd: "apps/ms-identity",
    args: ["dist/main.js"],
    env: {
      IDENTITY_PORT: "3002",
      IDENTITY_DATABASE_URL: db,
      BETTER_AUTH_SECRET: "development-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: "http://localhost:3002",
      IDENTITY_TRUSTED_ORIGINS: "http://localhost:4173,http://localhost:5173",
      IDENTITY_ISSUER: "http://localhost:3000/identity",
      IDENTITY_AUDIENCE: "axial-projects",
      IDENTITY_PRIVATE_KEY_PATH: `${keys}/dev-private.pem`,
      IDENTITY_PUBLIC_KEY_PATH: `${keys}/dev-public.pem`,
    },
  },
  {
    name: "ms-notifications",
    port: 3003,
    cwd: "apps/ms-notifications",
    args: ["dist/main.js"],
    env: {
      NOTIFICATIONS_PORT: "3003",
      NOTIFICATIONS_DATABASE_URL: db,
      NOTIFICATIONS_REDIS_URL: redis,
      NOTIFICATIONS_PUBLIC_KEY_PATH: `${keys}/dev-public.pem`,
      NOTIFICATIONS_JWT_ISSUER: "http://localhost:3000/identity",
      NOTIFICATIONS_JWT_AUDIENCE: "axial-projects",
    },
  },
  {
    name: "ms-realtime",
    port: 3004,
    cwd: "apps/ms-realtime",
    args: ["dist/main.js"],
    env: {
      REALTIME_PORT: "3004",
      REALTIME_NAMESPACE: "axial-dev",
      REDIS_URL: redis,
      JWT_ISSUER: "http://localhost:3000/identity",
      JWT_AUDIENCE: "axial-projects",
      JWT_PUBLIC_KEY_PATH: `${keys}/dev-public.pem`,
      PROJECTS_API_URL: "http://localhost:3001",
    },
  },
  {
    name: "ms-audit",
    port: 3005,
    cwd: "apps/ms-audit",
    args: ["dist/main.js"],
    env: {
      AUDIT_PORT: "3005",
      AUDIT_DATABASE_URL: db,
      AUDIT_REDIS_URL: redis,
      AUDIT_PUBLIC_KEY_PATH: `${keys}/dev-public.pem`,
      AUDIT_JWT_ISSUER: "http://localhost:3000/identity",
      AUDIT_JWT_AUDIENCE: "axial-projects",
    },
  },
  {
    name: "mcp-server",
    port: 3006,
    cwd: "apps/mcp-server",
    args: ["dist/main.js"],
    env: {
      MCP_PORT: "3006",
      MCP_RESOURCE: "http://localhost:3006/mcp",
      MCP_PUBLIC_KEY_PATH: `${keys}/dev-public.pem`,
      MCP_JWT_ISSUER: "http://localhost:3000/identity",
      MCP_JWT_AUDIENCE: "axial-projects",
      PROJECTS_API_URL: "http://localhost:3001",
      MCP_ALLOWED_ORIGINS: "http://localhost:4173,http://localhost:5173",
    },
  },
  {
    name: "gateway",
    port: 3000,
    cwd: "apps/gateway",
    args: ["dist/main.js"],
    env: {
      GATEWAY_PORT: "3000",
      PROJECTS_API_URL: "http://localhost:3001",
      IDENTITY_API_URL: "http://localhost:3002",
      NOTIFICATIONS_API_URL: "http://localhost:3003",
      REALTIME_API_URL: "http://localhost:3004",
      AUDIT_API_URL: "http://localhost:3005",
      MCP_API_URL: "http://localhost:3006",
      GATEWAY_CORS_ORIGINS: "http://localhost:4173,http://localhost:5173",
    },
  },
  {
    name: "web",
    port: 4173,
    cwd: "apps/web",
    command: process.execPath,
    args: [
      join(root, "apps/web/node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "4173",
    ],
    env: {},
    health: "http://127.0.0.1:4173/",
  },
  {
    name: "insights",
    port: 5174,
    cwd: "apps/insights",
    command: process.execPath,
    args: [
      join(root, "apps/insights/node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "5174",
    ],
    env: {},
    health: "http://127.0.0.1:5174/remoteEntry.js",
  },
];

const health = {
  api: "http://127.0.0.1:3001/api/v1/health/live",
  "ms-identity": "http://127.0.0.1:3002/api/v1/health/live",
  "ms-notifications": "http://127.0.0.1:3003/api/v1/health/live",
  "ms-realtime": "http://127.0.0.1:3004/health/live",
  "ms-audit": "http://127.0.0.1:3005/api/v1/health/live",
  "mcp-server": "http://127.0.0.1:3006/health/live",
  gateway: "http://127.0.0.1:3000/api/v1/health/live",
  web: "http://127.0.0.1:4173/",
  insights: "http://127.0.0.1:5174/remoteEntry.js",
};

async function start() {
  const pids = [];
  for (const service of services) {
    if (await portOpen(service.port)) {
      console.log(`[stack] ${service.name} já está na porta ${service.port}`);
      continue;
    }
    const log = openSync(join(logsDir, `${service.name}.log`), "a");
    const child = spawn(service.command ?? process.execPath, service.args, {
      cwd: join(root, service.cwd),
      env: { ...baseEnv, ...service.env },
      detached: true,
      shell: process.platform === "win32" && (service.command ?? "").endsWith(".cmd"),
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    child.unref();
    pids.push({ name: service.name, pid: child.pid, port: service.port });
    console.log(`[stack] ${service.name} iniciado (pid ${child.pid}, porta ${service.port})`);
  }
  writeFileSync(join(perfDir, "pids.json"), JSON.stringify(pids, null, 2));
  for (const service of services) await waitFor(service.health ?? health[service.name], 60_000);
  await waitFor("http://127.0.0.1:3000/api/v1/health/ready", 60_000);
  console.log("[stack] pronta");
}

async function stop() {
  const file = join(perfDir, "pids.json");
  const pids = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  if (!pids.length) console.log("[stack] nenhum pid registrado; liberando portas");
  for (const { name, pid } of pids) {
    if (!pid) continue;
    if (process.platform === "win32")
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      }
    }
    console.log(`[stack] ${name} encerrado (pid ${pid})`);
  }
  rmSync(file, { force: true });
}

async function token() {
  const result = await run(process.execPath, ["scripts/dev-identity.mjs", "token", "ADMIN"], {
    capture: true,
  });
  writeFileSync(join(perfDir, "token.txt"), result.stdout.trim());
  return result.stdout.trim();
}

const scenarios = [
  { name: "health-gateway", url: "http://127.0.0.1:3000/api/v1/health/live", connections: 100, duration: 10 },
  { name: "health-api", url: "http://127.0.0.1:3001/api/v1/health/live", connections: 100, duration: 10 },
  {
    name: "projects-api",
    url: "http://127.0.0.1:3001/api/v1/projects?page=1&pageSize=20",
    connections: 50,
    duration: 10,
  },
  {
    name: "projects-gateway",
    url: "http://127.0.0.1:3000/api/v1/projects?page=1&pageSize=20",
    connections: 50,
    duration: 10,
  },
  {
    name: "tasks-api",
    url: "http://127.0.0.1:3001/api/v1/projects/PROJECT/tasks?page=1&pageSize=20",
    connections: 50,
    duration: 10,
  },
  {
    name: "audit-gateway",
    url: "http://127.0.0.1:3000/api/v1/audit?page=1&pageSize=20",
    connections: 30,
    duration: 10,
  },
  {
    name: "notifications-gateway",
    url: "http://127.0.0.1:3000/api/v1/notification-preferences",
    connections: 30,
    duration: 10,
  },
];

async function load() {
  const accessToken = await token();
  const projects = await fetch("http://127.0.0.1:3001/api/v1/projects?page=1&pageSize=1", {
    headers: { authorization: `Bearer ${accessToken}` },
  }).then((response) => response.json());
  const projectId = projects?.items?.[0]?.id ?? projects?.data?.[0]?.id;
  if (!projectId) throw new Error("Não foi possível obter um project id para o cenário de tarefas");
  const results = {};
  for (const scenario of scenarios) {
    const url = scenario.url.replace("PROJECT", projectId);
    console.log(`[load] ${scenario.name}`);
    const { stdout } = await run(
      process.execPath,
      [
        autocannonCli,
        "-j",
        "-c",
        String(scenario.connections),
        "-d",
        String(scenario.duration),
        "-H",
        `authorization: Bearer ${accessToken}`,
        url,
      ],
      { capture: true },
    );
    const report = JSON.parse(stdout);
    writeFileSync(join(rawDir, `${scenario.name}.json`), JSON.stringify(report, null, 2));
    results[scenario.name] = {
      throughput: Math.round(report.requests.average),
      p50: report.latency.p50,
      p99: report.latency.p99,
      errors: report.errors,
      non2xx: report.non2xx,
    };
    console.log(
      `[load] ${scenario.name}: ${results[scenario.name].throughput} req/s, p50 ${results[scenario.name].p50} ms`,
    );
  }
  writeFileSync(join(perfDir, "results-load.json"), JSON.stringify(results, null, 2));

  if (process.env.PERF_LOGIN_EMAIL && process.env.PERF_LOGIN_PASSWORD && process.env.PERF_LOGIN_ORG) {
    const body = JSON.stringify({
      email: process.env.PERF_LOGIN_EMAIL,
      password: process.env.PERF_LOGIN_PASSWORD,
      organizationId: process.env.PERF_LOGIN_ORG,
    });
    const samples = [];
    const statuses = {};
    for (let index = 0; index < 10; index++) {
      const start = performance.now();
      const response = await fetch("http://127.0.0.1:3002/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      await response.text();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    writeFileSync(
      join(perfDir, "results-login.json"),
      JSON.stringify(
        { samples: samples.map((value) => Math.round(value)), p50: Math.round(samples[5]), statuses },
        null,
        2,
      ),
    );
    console.log(`[load] login p50 ${Math.round(samples[5])} ms`);
  }
}

async function web() {
  console.log("[web] Web Vitals");
  await run(pnpm, ["--filter", "@axial/web", "exec", "node", "scripts/collect-web-vitals.mjs"], {
    env: { ...process.env, WEB_URL: process.env.WEB_URL ?? "http://127.0.0.1:4173" },
  });
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = [process.env.LOCALAPPDATA, process.env.HOME].filter(Boolean);
  for (const base of roots) {
    try {
      const candidates = readdirSync(base)
        .filter((name) => name.startsWith("ms-playwright"))
        .flatMap((name) => readdirSync(join(base, name)).filter((entry) => entry.startsWith("chromium-")))
        .sort()
        .reverse();
      for (const entry of candidates) {
        for (const relative of [
          "chrome-win64/chrome.exe",
          "chrome-linux/chrome",
          "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        ]) {
          const candidate = join(base, "ms-playwright", entry, relative);
          if (existsSync(candidate)) return candidate;
        }
      }
    } catch {}
  }
  return undefined;
}

async function lighthouse() {
  const chrome = findChrome();
  const runs = [
    { name: "desktop", args: ["--preset=desktop"] },
    { name: "mobile", args: [] },
  ];
  const results = {};
  for (const profile of runs) {
    console.log(`[lighthouse] ${profile.name}`);
    const output = join(lighthouseDir, profile.name);
    await run(
      process.execPath,
      [
        lighthouseCli,
        process.env.WEB_URL ?? "http://127.0.0.1:4173/#/dashboard",
        "--quiet",
        "--chrome-flags=--headless=new --no-sandbox",
        ...profile.args,
        "--output=json",
        "--output=html",
        `--output-path=${output}`,
        "--only-categories=performance,accessibility,best-practices,seo",
      ],
      { env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) } },
    );
    const report = JSON.parse(readFileSync(`${output}.report.json`, "utf8"));
    results[profile.name] = {
      performance: report.categories.performance.score ?? null,
      accessibility: report.categories.accessibility?.score ?? null,
      bestPractices: report.categories["best-practices"]?.score ?? null,
      seo: report.categories.seo?.score ?? null,
      fcp: report.audits["first-contentful-paint"].displayValue,
      lcp: report.audits["largest-contentful-paint"].displayValue,
      tbt: report.audits["total-blocking-time"].displayValue,
      cls: report.audits["cumulative-layout-shift"].displayValue,
      speedIndex: report.audits["speed-index"].displayValue,
      totalBytes: report.audits["total-byte-weight"].displayValue,
    };
    copyFileSync(
      `${output}.report.json`,
      join(docsDir, "evidencias", `lighthouse-${profile.name}.report.json`),
    );
    copyFileSync(
      `${output}.report.html`,
      join(docsDir, "evidencias", `lighthouse-${profile.name}.report.html`),
    );
  }
  writeFileSync(join(perfDir, "results-lighthouse.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

function report() {
  const read = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
  const vitals = {};
  for (const profile of ["desktop", "mobile"])
    for (const route of ["dashboard", "projects"]) {
      const file = join(vitalsDir, `${profile}-${route}.json`);
      if (existsSync(file)) vitals[`${profile}-${route}`] = JSON.parse(readFileSync(file, "utf8"));
    }
  const previous = read(join(docsDir, "resultados.json"), {});
  const summary = {
    ...previous,
    collectedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, browser: "Chromium (Playwright)" },
    load: read(join(perfDir, "results-load.json"), previous.load ?? {}),
    lighthouse: read(join(perfDir, "results-lighthouse.json"), previous.lighthouse ?? {}),
    login: read(join(perfDir, "results-login.json"), previous.login ?? null),
    vitals,
  };
  writeFileSync(
    process.env.PERF_REPORT_OUT ?? join(docsDir, "resultados.json"),
    JSON.stringify(summary, null, 2),
  );
  writeFileSync(join(docsDir, "evidencias", "vitals.json"), JSON.stringify(vitals, null, 2));
  for (const file of readdirSync(rawDir))
    copyFileSync(join(rawDir, file), join(docsDir, "evidencias", "load", file));
  console.log("[report] docs/performance/resultados.json");
}

async function all() {
  let started = false;
  let failed = false;
  try {
    if (process.env.PERF_SKIP_INFRA !== "1") {
      console.log("[infra] docker compose up");
      await run("docker", ["compose", "up", "-d", "--wait"]);
    }
    const env = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? `${db}?schema=projects`,
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? `${db}?schema=projects`,
      IDENTITY_DATABASE_URL: process.env.IDENTITY_DATABASE_URL ?? db,
      NOTIFICATIONS_DATABASE_URL: process.env.NOTIFICATIONS_DATABASE_URL ?? db,
      AUDIT_DATABASE_URL: process.env.AUDIT_DATABASE_URL ?? db,
    };
    console.log("[db] migrations e seed");
    await run(pnpm, ["db:generate"], { env });
    await run(pnpm, ["db:migrate"], { env });
    await run(pnpm, ["db:seed"], { env });
    for (const script of ["db:identity:migrate", "db:notifications:migrate", "db:audit:migrate"])
      await run(pnpm, [script], { env });
    console.log("[build] monorepo");
    await run(pnpm, ["build"]);
    await start();
    started = true;
    await load();
    await web();
    await lighthouse();
    report();
  } catch (error) {
    failed = true;
    console.error(error.message);
  } finally {
    if (started && process.env.PERF_KEEP_STACK !== "1") await stop();
    process.exitCode = failed ? 1 : 0;
  }
}

const command = process.argv[2] ?? "all";
try {
  if (command === "stack") await start();
  else if (command === "stop") await stop();
  else if (command === "load") await load();
  else if (command === "web") await web();
  else if (command === "lighthouse") await lighthouse();
  else if (command === "report") report();
  else if (command === "all") await all();
  else throw new Error(`Comando desconhecido: ${command}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
