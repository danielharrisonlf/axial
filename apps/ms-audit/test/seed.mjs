import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Runs the demo seed against a disposable *_test database: the first run writes the history, later
// runs write nothing, and an event removed in between is reported as a warning, not restored.
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
  assert.equal(first.status, "seeded");
  assert.deepEqual(first.warnings, []);
  const second = report(run(["src/seed-demo.ts", "--test"]));
  assert.equal(second.status, "already seeded");
  assert.equal(second.inserted, 0);
  assert.equal(second.present, 74);
  assert.deepEqual(second.warnings, []);

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

  // An event removed after the first run is not restored; the shortfall is a warning, exit code 0.
  // audit.events is append only, so the removal (an operator's manual cleanup, for example) has to
  // bypass the trigger that refuses deletes; only this disposable database is touched.
  const removed = (await db.query("SELECT id FROM audit.events ORDER BY occurred_at LIMIT 1")).rows[0].id;
  await db.query("ALTER TABLE audit.events DISABLE TRIGGER audit_events_no_delete");
  await db.query("DELETE FROM audit.events WHERE id=$1", [removed]);
  await db.query("ALTER TABLE audit.events ENABLE TRIGGER audit_events_no_delete");
  const third = report(run(["src/seed-demo.ts", "--test"]));
  assert.equal(third.status, "already seeded");
  assert.equal(third.inserted, 0);
  assert.equal(third.present, 73);
  assert.deepEqual(third.warnings, [
    "events: 73 of 74 scenario events present; missing events are not restored",
  ]);
  assert.equal(
    (await db.query("SELECT count(*)::int AS count FROM audit.events WHERE id=$1", [removed])).rows[0].count,
    0,
  );
  console.log("Audit demo seed: 74 events, first run only; removed events stay removed and are reported");
} catch (error) {
  failure = error;
} finally {
  if (db) await db.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
}
if (failure) throw failure;
