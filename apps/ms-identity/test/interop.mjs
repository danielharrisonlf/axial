// Run from apps/ms-identity: IDENTITY_TEST_DATABASE_URL must name a disposable
// *_test database; its PostgreSQL user needs CREATEDB. TEST_REDIS_URL is required.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const source = process.env.IDENTITY_TEST_DATABASE_URL;
if (!source) throw new Error("IDENTITY_TEST_DATABASE_URL is required");
const baseUrl = new URL(source);
if (
  !["postgres:", "postgresql:"].includes(baseUrl.protocol) ||
  !decodeURIComponent(baseUrl.pathname).endsWith("_test")
)
  throw new Error("IDENTITY_TEST_DATABASE_URL must name a PostgreSQL *_test database");
const redis = process.env.TEST_REDIS_URL;
if (!redis || !["redis:", "rediss:"].includes(new URL(redis).protocol))
  throw new Error("TEST_REDIS_URL must point to isolated Redis");

const identityDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectsDir = resolve(identityDir, "../api");
const admin = new pg.Pool({ connectionString: source });
const suffix = randomUUID().replaceAll("-", "");
const names = [`axial_interop_identity_${suffix}_test`, `axial_interop_projects_${suffix}_test`];
const created = [];
const tempDir = mkdtempSync(join(tmpdir(), "axial-interop-"));
const servers = [];
const dbUrl = (name) => {
  const u = new URL(source);
  u.pathname = `/${name}`;
  return u.toString();
};
const pair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
writeFileSync(join(tempDir, "private.pem"), pair.privateKey, { mode: 0o600 });
writeFileSync(join(tempDir, "public.pem"), pair.publicKey);

async function freePort() {
  const socket = createServer();
  await new Promise((resolvePort, reject) =>
    socket.once("error", reject).listen(0, "127.0.0.1", resolvePort),
  );
  const port = socket.address().port;
  await new Promise((resolveClose, reject) =>
    socket.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}
function run(cwd, args, env) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`Command failed: ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
}
async function ready(url, server) {
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error(`Service exited with ${server.exitCode}`);
    try {
      if ((await fetch(`${url}/health/live`)).ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Service not ready: ${url}`);
}
async function request(base, path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

try {
  for (const name of names) {
    await admin.query(`CREATE DATABASE "${name}"`);
    created.push(name);
  }
  const identityPort = await freePort();
  let projectsPort = await freePort();
  while (projectsPort === identityPort) projectsPort = await freePort();
  const issuer = "https://identity.interop.test";
  const audience = "axial-interop-projects";
  const env = {
    ...process.env,
    NODE_ENV: "test",
    IDENTITY_DATABASE_URL: dbUrl(names[0]),
    IDENTITY_PRIVATE_KEY_PATH: join(tempDir, "private.pem"),
    IDENTITY_PUBLIC_KEY_PATH: join(tempDir, "public.pem"),
    IDENTITY_PORT: String(identityPort),
    IDENTITY_ISSUER: issuer,
    IDENTITY_AUDIENCE: audience,
    IDENTITY_BOOTSTRAP_EMAIL: "admin@example.test",
    IDENTITY_BOOTSTRAP_PASSWORD: "interop-test-password",
    IDENTITY_BOOTSTRAP_ORGANIZATION: "Interop organization",
    DATABASE_URL: dbUrl(names[1]),
    REDIS_URL: redis,
    JWT_ISSUER: issuer,
    JWT_AUDIENCE: audience,
    JWT_PUBLIC_KEY_PATH: join(tempDir, "public.pem"),
    PORT: String(projectsPort),
    RELAY_ENABLED: "false",
  };
  delete env.JWT_JWKS_URL;
  for (const file of ["src/migrate.ts", "src/bootstrap.ts"]) run(identityDir, ["--import", "tsx", file], env);
  run(projectsDir, ["node_modules/prisma/build/index.js", "migrate", "deploy"], env);
  const identityDb = new pg.Pool({ connectionString: dbUrl(names[0]) });
  let organization;
  try {
    organization = (await identityDb.query("SELECT id FROM identity.organizations LIMIT 1")).rows[0].id;
  } finally {
    await identityDb.end();
  }
  const identityServer = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: identityDir,
    env,
    stdio: "inherit",
  });
  servers.push(identityServer);
  const projectsServer = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: projectsDir,
    env,
    stdio: "inherit",
  });
  servers.push(projectsServer);
  const identity = `http://127.0.0.1:${identityPort}/api/v1`;
  const projects = `http://127.0.0.1:${projectsPort}/api/v1`;
  await Promise.all([ready(identity, identityServer), ready(projects, projectsServer)]);
  const credentials = {
    email: "admin@example.test",
    password: "interop-test-password",
    organizationId: organization,
  };
  const login = await request(identity, "auth/login", { method: "POST", body: credentials });
  assert.equal(login.status, 201);
  assert.equal(login.body.requiresPasswordChange, false);
  const token = login.body.accessToken;
  const project = await request(projects, "projects", {
    method: "POST",
    token,
    body: { key: "INTR", name: "Interop project" },
  });
  assert.equal(project.status, 201);
  assert.equal((await request(projects, `projects/${project.body.id}`, { token })).status, 200);
  const other = await request(identity, "organizations", {
    method: "POST",
    token,
    body: { name: "Other organization" },
  });
  assert.equal(other.status, 201);
  const otherLogin = await request(identity, "auth/login", {
    method: "POST",
    body: { ...credentials, organizationId: other.body.id },
  });
  assert.equal(otherLogin.status, 201);
  assert.equal(
    (await request(projects, `projects/${project.body.id}`, { token: otherLogin.body.accessToken })).status,
    404,
  );
  const parts = token.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  assert.equal((await request(projects, "projects", { token: parts.join(".") })).status, 401);
  const member = await request(identity, "members", {
    method: "POST",
    token,
    body: { email: "viewer@example.test", password: "temporary-password", role: "VIEWER" },
  });
  assert.equal(member.status, 201);
  const temporary = await request(identity, "auth/login", {
    method: "POST",
    body: { email: "viewer@example.test", password: "temporary-password", organizationId: organization },
  });
  assert.equal(temporary.status, 201);
  assert.equal(temporary.body.requiresPasswordChange, true);
  assert.equal((await request(projects, "projects", { token: temporary.body.accessToken })).status, 401);
  console.log(
    "Interop passed: signed login, project access, organization isolation, tampering and temporary token rejection",
  );
} finally {
  for (const server of servers) {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = new Promise((resolveExit) => server.once("exit", resolveExit));
      server.kill();
      await exited;
    }
  }
  for (const name of created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
  rmSync(tempDir, { recursive: true, force: true });
}
