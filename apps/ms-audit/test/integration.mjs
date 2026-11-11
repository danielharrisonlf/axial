import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { SignJWT, importPKCS8 } from "jose";
import pg from "pg";

const url = process.env.AUDIT_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("AUDIT_TEST_DATABASE_URL must name a _test database");
const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl) throw new Error("TEST_REDIS_URL is required");
const admin = new pg.Pool({ connectionString: url });
const databaseName = `axial_audit_${randomUUID().replaceAll("-", "")}_test`;
const testUrl = new URL(url);
testUrl.pathname = `/${databaseName}`;
const db = new pg.Pool({ connectionString: testUrl.toString() });
const dir = mkdtempSync(join(tmpdir(), "audit-test-"));
const pair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
writeFileSync(join(dir, "public.pem"), pair.publicKey);
const privateKey = await importPKCS8(pair.privateKey, "RS256");
const port = 3205;
const env = {
  ...process.env,
  NODE_ENV: "test",
  AUDIT_DATABASE_URL: testUrl.toString(),
  AUDIT_REDIS_URL: redisUrl,
  AUDIT_PUBLIC_KEY_PATH: join(dir, "public.pem"),
  AUDIT_JWT_ISSUER: "http://localhost:3000/identity",
  AUDIT_JWT_AUDIENCE: "axial-projects",
  AUDIT_PORT: String(port),
};
const organization = randomUUID();
const project = randomUUID();
const otherProject = randomUUID();
const actor = randomUUID();
let server;
let serverClosed;
let queue;
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
let created = false;
let failure;
const cleanupErrors = [];

async function token(role, projectIds = []) {
  return new SignJWT({ organizationId: organization, role, projectIds })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setSubject(actor)
    .setIssuer("http://localhost:3000/identity")
    .setAudience("axial-projects")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}
function event(overrides = {}) {
  return {
    id: randomUUID(),
    type: "task.completed",
    version: 1,
    occurredAt: "2026-11-10T12:00:00.000Z",
    organizationId: organization,
    projectId: project,
    aggregate: { type: "task", id: randomUUID(), version: 2 },
    actor: { id: actor, source: "ui" },
    correlationId: randomUUID(),
    data: { before: { status: "in_review" }, after: { status: "done" } },
    ...overrides,
  };
}
async function request(path, accessToken) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/${path}`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
  return { status: response.status, body: await response.json() };
}
async function waitForConnections(name) {
  for (let i = 0; i < 100; i++) {
    const result = await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1", [
      name,
    ]);
    if (result.rows[0].count === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Connections remain open for test database ${name}`);
}
async function waitForRows(count) {
  for (let i = 0; i < 100; i++) {
    const result = await db.query("SELECT count(*)::int AS count FROM audit.events");
    if (result.rows[0].count >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${count} audit rows`);
}

try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const migrate = spawnSync(process.execPath, ["--import", "tsx", "src/migrate.ts"], { env, encoding: "utf8" });
  if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
  server = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], { env, stdio: "inherit" });
  serverClosed = new Promise((resolve) => server.once("close", resolve));
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "audit service failed to start");

  queue = new Queue("axial-audit", { connection });
  const first = event();
  const second = event({
    type: "project.updated",
    projectId: otherProject,
    aggregate: { type: "project", id: otherProject, version: 3 },
    occurredAt: "2026-11-09T09:00:00.000Z",
  });
  await queue.add("task.completed", first, { jobId: first.id });
  await queue.add("project.updated", second, { jobId: second.id });
  await waitForRows(2);
  // A redelivered event must not duplicate the record.
  await queue.add("task.completed", first);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal((await db.query("SELECT count(*)::int AS count FROM audit.events")).rows[0].count, 2);

  const adminToken = await token("ADMIN");
  const list = await request("audit?page=1&pageSize=10", adminToken);
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 2);
  assert.equal(list.body.items.length, 2);
  assert.equal(list.body.items[0].eventType, "task.completed");

  const filtered = await request(`audit?projectId=${otherProject}`, adminToken);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.items[0].eventType, "project.updated");
  assert.equal((await request("audit?eventType=task.completed", adminToken)).body.total, 1);
  assert.equal((await request("audit?search=project", adminToken)).body.total, 1);
  assert.equal((await request("audit?from=2026-11-10T00:00:00.000Z", adminToken)).body.total, 1);

  const contributor = await request("audit", await token("CONTRIBUTOR", [project]));
  assert.equal(contributor.status, 403);
  assert.equal((await request("audit", null)).status, 401);

  const leadToken = await token("TEAM_LEAD", [project]);
  const lead = await request("audit", leadToken);
  assert.equal(lead.status, 200);
  assert.equal(lead.body.total, 1);
  assert.equal(lead.body.items[0].projectId, project);
  assert.equal((await request(`audit?projectId=${otherProject}`, leadToken)).status, 403);

  const summary = await request("audit/summary", adminToken);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.total, 2);
  assert.deepEqual(summary.body.byDay, [
    { day: "2026-11-09", count: 1 },
    { day: "2026-11-10", count: 1 },
  ]);
  assert.equal((await request("audit/summary", leadToken)).body.total, 1);

  await assert.rejects(
    db.query("UPDATE audit.events SET event_type='tampered'"),
    /append-only/,
  );
  await assert.rejects(db.query("DELETE FROM audit.events"), /append-only/);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM audit.events")).rows[0].count, 2);

  assert.equal((await request("audit?page=0", adminToken)).status, 400);
  assert.equal((await request("audit?organizationId=" + organization, adminToken)).status, 400);
  console.log("Integration passed: audit ingestion, dedupe, visibility, filters and append-only storage");
} catch (error) {
  failure = error;
} finally {
  const cleanup = async (operation) => {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(error);
    }
  };
  await cleanup(async () => {
    if (queue) await queue.close();
    await connection.quit();
  });
  await cleanup(async () => {
    if (server) {
      if (server.exitCode === null && server.signalCode === null) server.kill();
      await serverClosed;
    }
  });
  await cleanup(() => db.end());
  if (created)
    await cleanup(async () => {
      await waitForConnections(databaseName);
      await admin.query(`DROP DATABASE "${databaseName}"`);
    });
  await cleanup(() => admin.end());
  await cleanup(() => rmSync(dir, { recursive: true, force: true }));
}
const errors = [...(failure ? [failure] : []), ...cleanupErrors];
if (errors.length) throw new AggregateError(errors, "Audit integration test or cleanup failed");
