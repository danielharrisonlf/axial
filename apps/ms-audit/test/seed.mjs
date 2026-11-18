import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Runs the demo seed twice against a disposable *_test database and checks the audit history.
const url = process.env.AUDIT_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("AUDIT_TEST_DATABASE_URL must name a _test database");
const admin = new pg.Pool({ connectionString: url });
const databaseName = `axial_audit_seed_${randomUUID().replaceAll("-", "")}_test`;
const testUrl = new URL(url);
testUrl.pathname = `/${databaseName}`;
const env = {
  ...process.env,
  NODE_ENV: "test",
  AUDIT_DATABASE_URL: testUrl.toString(),
  AUDIT_TEST_DATABASE_URL: testUrl.toString(),
};
const run = (args) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", ...args], { env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};
const report = (stdout) => JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1));

let created = false;
let db;
let failure;
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  run(["src/migrate.ts"]);
  // the development entry point refuses a *_test database
  const refused = spawnSync(process.execPath, ["--import", "tsx", "src/seed-demo.ts"], {
    env,
    encoding: "utf8",
  });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /\*_dev database/);

  const first = report(run(["src/seed-demo.ts", "--test"]));
  assert.equal(first.inserted, 74);
  assert.equal(first.present, 74);
  assert.deepEqual(
    first.excluded.map((item) => item.legacyId),
    ["au69"],
  );
  const second = report(run(["src/seed-demo.ts", "--test"]));
  assert.equal(second.inserted, 0);
  assert.equal(second.present, 74);

  db = new pg.Pool({ connectionString: testUrl.toString() });
  const types = await db.query(
    "SELECT event_type, count(*)::int AS count FROM audit.events GROUP BY event_type ORDER BY event_type",
  );
  assert.deepEqual(Object.fromEntries(types.rows.map((row) => [row.event_type, row.count])), {
    "project.created": 11,
    "sprint.started": 3,
    "task.assigned": 7,
    "task.completed": 14,
    "task.created": 31,
    "task.status_changed": 8,
  });
  const sources = await db.query("SELECT DISTINCT actor_source FROM audit.events ORDER BY 1");
  assert.deepEqual(
    sources.rows.map((row) => row.actor_source),
    ["automation", "mcp", "ui"],
  );
  const future = await db.query("SELECT count(*)::int AS count FROM audit.events WHERE occurred_at > now()");
  assert.equal(future.rows[0].count, 0);
  console.log("Audit demo seed: 74 events, idempotent on repeat");
} catch (error) {
  failure = error;
} finally {
  if (db) await db.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
}
if (failure) throw failure;
