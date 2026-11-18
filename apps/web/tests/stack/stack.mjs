// Local stack for the Workspace stack tests (tests/stack/*.spec.ts), isolated from `pnpm start`:
//   node tests/stack/stack.mjs up     disposable *_test database with the Vetor Labs scenario, the seven
//                                     services on ports 3100–3106 and the API-mode Workspace on 4273
//   node tests/stack/stack.mjs down   stops what `up` started
// Needs the docker compose infrastructure (postgres-test on 5550, redis on 6389) and a built monorepo
// (`pnpm db:generate && pnpm build`); STACK_SKIP_BUILD=1 reuses the current apps/web/dist.
// Writes only to the database below (name ending in _test, recreated on every `up`) and Redis db 7.
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const work = join(root, "output/validation/stack");
const keys = join(work, "keys");
const logs = join(work, "logs");
const pidsFile = join(work, "pids.json");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const database = process.env.STACK_DATABASE ?? "axial_webstack_test";
if (!database.endsWith("_test")) throw new Error("STACK_DATABASE must end in _test");
const pgContainer = process.env.STACK_PG_CONTAINER ?? "axial-postgres-test-1";
const db = `postgresql://axial:axial_local_only@localhost:5550/${database}`;
const redis = "redis://localhost:6389/7";
// development-only fixture, as in scripts/performance/run.mjs (never used in deploy)
export const demoPassword = process.env.AXIAL_DEMO_PASSWORD ?? "vetor-labs-local-only";
const web = "http://localhost:4273";
const issuer = "http://localhost:3100/identity";
const audience = "axial-projects";
const pub = join(keys, "public.pem");
const priv = join(keys, "private.pem");

const services = [
  {
    name: "api",
    port: 3101,
    cwd: "apps/api",
    env: {
      PORT: "3101",
      DATABASE_URL: `${db}?schema=projects`,
      REDIS_URL: redis,
      JWT_ISSUER: issuer,
      JWT_AUDIENCE: audience,
      JWT_PUBLIC_KEY_PATH: pub,
      RELAY_ENABLED: "true",
      RELAY_POLL_MS: "300",
      CORS_ORIGINS: web,
    },
    health: "http://127.0.0.1:3101/api/v1/health/live",
  },
  {
    name: "ms-identity",
    port: 3102,
    cwd: "apps/ms-identity",
    env: {
      IDENTITY_PORT: "3102",
      IDENTITY_DATABASE_URL: db,
      BETTER_AUTH_SECRET: "stack-test-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: "http://localhost:3102",
      IDENTITY_TRUSTED_ORIGINS: web,
      IDENTITY_ISSUER: issuer,
      IDENTITY_AUDIENCE: audience,
      IDENTITY_OAUTH_RESOURCE: "http://localhost:3106/mcp",
      IDENTITY_PRIVATE_KEY_PATH: priv,
      IDENTITY_PUBLIC_KEY_PATH: pub,
      IDENTITY_TRUST_PROXY: "1",
      IDENTITY_SIGNUP_ENABLED: "true",
      IDENTITY_WEB_URL: web,
      IDENTITY_SESSION_COOKIE_SECURE: "false",
    },
    health: "http://127.0.0.1:3102/api/v1/health/live",
  },
  {
    name: "ms-realtime",
    port: 3104,
    cwd: "apps/ms-realtime",
    env: {
      REALTIME_PORT: "3104",
      REALTIME_NAMESPACE: "axial-webstack",
      REDIS_URL: redis,
      JWT_ISSUER: issuer,
      JWT_AUDIENCE: audience,
      JWT_PUBLIC_KEY_PATH: pub,
      PROJECTS_API_URL: "http://localhost:3101/api/v1",
    },
    health: "http://127.0.0.1:3104/health/live",
  },
  {
    name: "ms-audit",
    port: 3105,
    cwd: "apps/ms-audit",
    env: {
      AUDIT_PORT: "3105",
      AUDIT_DATABASE_URL: db,
      AUDIT_REDIS_URL: redis,
      AUDIT_PUBLIC_KEY_PATH: pub,
      AUDIT_JWT_ISSUER: issuer,
      AUDIT_JWT_AUDIENCE: audience,
    },
    health: "http://127.0.0.1:3105/api/v1/health/live",
  },
  {
    name: "ms-notifications",
    port: 3103,
    cwd: "apps/ms-notifications",
    env: {
      NOTIFICATIONS_PORT: "3103",
      NOTIFICATIONS_DATABASE_URL: db,
      NOTIFICATIONS_REDIS_URL: redis,
      NOTIFICATIONS_PUBLIC_KEY_PATH: pub,
      NOTIFICATIONS_JWT_ISSUER: issuer,
      NOTIFICATIONS_JWT_AUDIENCE: audience,
    },
    health: "http://127.0.0.1:3103/api/v1/health/live",
  },
  {
    name: "mcp-server",
    port: 3106,
    cwd: "apps/mcp-server",
    env: {
      MCP_PORT: "3106",
      MCP_RESOURCE: "http://localhost:3106/mcp",
      MCP_PUBLIC_KEY_PATH: pub,
      MCP_JWT_ISSUER: issuer,
      MCP_JWT_AUDIENCE: audience,
      PROJECTS_API_URL: "http://localhost:3101",
      MCP_ALLOWED_ORIGINS: web,
      MCP_ALLOWED_HOSTS: "localhost,127.0.0.1,[::1]",
    },
    health: "http://127.0.0.1:3106/health/live",
  },
  {
    name: "gateway",
    port: 3100,
    cwd: "apps/gateway",
    env: {
      GATEWAY_PORT: "3100",
      PROJECTS_API_URL: "http://localhost:3101",
      IDENTITY_API_URL: "http://localhost:3102",
      NOTIFICATIONS_API_URL: "http://localhost:3103",
      REALTIME_API_URL: "http://localhost:3104",
      AUDIT_API_URL: "http://localhost:3105",
      MCP_API_URL: "http://localhost:3106",
      GATEWAY_CORS_ORIGINS: web,
    },
    health: "http://127.0.0.1:3100/api/v1/health/live",
  },
  {
    // API-mode Workspace, same origin: Vite preview proxies /api, /mcp and /ws to the gateway
    name: "web",
    port: 4273,
    cwd: "apps/web",
    command: process.execPath,
    args: [
      join(root, "apps/web/node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "localhost",
      "--port",
      "4273",
    ],
    env: { VITE_API_PROXY_TARGET: "http://localhost:3100" },
    health: `${web}/`,
  },
];

function run(command, args, env = {}, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
}
const portOpen = (port) =>
  new Promise((done) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.end();
      done(true);
    });
    socket.once("error", () => done(false));
  });
async function waitFor(url, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${url}`);
}

function prepare() {
  mkdirSync(keys, { recursive: true });
  mkdirSync(logs, { recursive: true });
  if (!existsSync(priv)) {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    writeFileSync(priv, pair.privateKey, { mode: 0o600 });
    writeFileSync(pub, pair.publicKey);
  }
  console.log(`[stack] recreating ${database}`);
  run("docker", ["exec", pgContainer, "dropdb", "-U", "axial", "--if-exists", "--force", database]);
  run("docker", ["exec", pgContainer, "createdb", "-U", "axial", database]);
  const env = {
    DATABASE_URL: `${db}?schema=projects`,
    TEST_DATABASE_URL: `${db}?schema=projects`,
    IDENTITY_DATABASE_URL: db,
    IDENTITY_TEST_DATABASE_URL: db,
    NOTIFICATIONS_DATABASE_URL: db,
    AUDIT_DATABASE_URL: db,
    AUDIT_TEST_DATABASE_URL: db,
    AXIAL_DEMO_PASSWORD: demoPassword,
  };
  run(pnpm, ["--filter", "@axial/ms-projects", "db:migrate"], env);
  for (const app of ["@axial/ms-identity", "@axial/ms-notifications", "@axial/ms-audit"])
    run(pnpm, ["--filter", app, "db:migrate"], env);
  for (const app of ["@axial/ms-identity", "@axial/ms-projects", "@axial/ms-audit"])
    run(pnpm, ["--filter", app, "db:seed:test"], env);
  if (process.env.STACK_SKIP_BUILD !== "1")
    run(pnpm, ["--filter", "@axial/web", "build"], { VITE_WORKSPACE_SOURCE: "api", VITE_API_BASE_URL: "" });
}

async function up() {
  for (const service of services)
    if (await portOpen(service.port)) throw new Error(`port ${service.port} (${service.name}) is busy`);
  prepare();
  const pids = [];
  for (const service of services) {
    const out = openSync(join(logs, `${service.name}.log`), "w");
    const child = spawn(service.command ?? process.execPath, service.args ?? ["dist/main.js"], {
      cwd: join(root, service.cwd),
      env: { ...process.env, NODE_ENV: "development", ...service.env },
      stdio: ["ignore", out, out],
      detached: true,
      windowsHide: true,
    });
    child.unref();
    pids.push({ name: service.name, pid: child.pid, port: service.port });
    writeFileSync(pidsFile, JSON.stringify(pids, null, 2));
    await waitFor(service.health);
    console.log(`[stack] ${service.name} up on ${service.port}`);
  }
  console.log(
    `[stack] Workspace (API mode) at ${web}; demo password: AXIAL_DEMO_PASSWORD or the local fixture`,
  );
}

function down() {
  if (!existsSync(pidsFile)) return console.log("[stack] nothing to stop");
  for (const { name, pid } of JSON.parse(readFileSync(pidsFile, "utf8"))) {
    try {
      if (process.platform === "win32")
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-pid, "SIGTERM");
      console.log(`[stack] stopped ${name}`);
    } catch {
      console.log(`[stack] ${name} was not running`);
    }
  }
  rmSync(pidsFile);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === "up") await up();
  else if (command === "down") down();
  else throw new Error("usage: node tests/stack/stack.mjs up|down");
}
