import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

const dbUrl = process.env.TEST_DATABASE_URL,
  redisUrl = process.env.TEST_REDIS_URL;
if (
  !dbUrl ||
  !redisUrl ||
  !/^\/axial_notifications_[0-9a-f]{32}_test$/.test(new URL(dbUrl).pathname) ||
  !/^\/(?:[1-9]|1[0-5])$/.test(new URL(redisUrl).pathname)
)
  throw new Error(
    "TEST_DATABASE_URL must end in _test and TEST_REDIS_URL must select a nonzero isolated database",
  );
process.env.NOTIFICATIONS_DATABASE_URL = dbUrl;
process.env.NOTIFICATIONS_REDIS_URL = redisUrl;
const migration = spawnSync(process.execPath, ["--import", "tsx", "src/migrate.ts"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
if (migration.status !== 0) throw new Error("Migration failed");
const { db } = await import("../dist/db.js");
const { startConsumer, ingest, dispatchOne, HttpProvider } = await import("../dist/consumer.js");
const conn = new Redis(redisUrl, { maxRetriesPerRequest: null });
const q = new Queue("axial-notifications", { connection: conn });
const org = randomUUID(),
  other = randomUUID(),
  user = randomUUID(),
  eventId = randomUUID(),
  task = randomUUID();
const event = {
  id: eventId,
  type: "task.completed",
  version: 1,
  occurredAt: new Date().toISOString(),
  organizationId: org,
  projectId: randomUUID(),
  aggregate: { type: "task", id: task, version: 1 },
  actor: { id: user, source: "api" },
  correlationId: "integration",
  data: { before: {}, after: { assigneeId: user } },
};
let worker;
try {
  await db.query(
    "INSERT INTO notifications.preferences(organization_id,user_id,channel,enabled,destination) VALUES($1,$2,'email',true,'test@example.com'),($1,$2,'sms',false,'+15555550123'),($3,$2,'whatsapp',true,'+15555550123')",
    [org, user, other],
  );
  worker = startConsumer();
  const job = await q.add(event.type, event, { jobId: event.id });
  for (let i = 0; i < 100; i++) {
    if ((await db.query("SELECT 1 FROM notifications.events WHERE id=$1", [eventId])).rowCount) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await db.query("SELECT 1 FROM notifications.events WHERE id=$1", [eventId])).rowCount, 1);
  await ingest(event);
  const rows = await db.query("SELECT * FROM notifications.deliveries WHERE event_id=$1", [eventId]);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].channel, "email");
  assert.equal(rows.rows[0].organization_id, org);
  assert.equal(
    await dispatchOne({
      send: async () => {
        throw new Error("offline");
      },
    }),
    true,
  );
  assert.equal(
    (await db.query("SELECT status FROM notifications.deliveries WHERE event_id=$1", [eventId])).rows[0]
      .status,
    "pending",
  );
  await db.query("UPDATE notifications.deliveries SET next_attempt_at=now() WHERE event_id=$1", [eventId]);
  let stableId;
  await dispatchOne({
    send: async (input) => {
      stableId = input.id;
      return "provider-confirmation";
    },
  });
  const finished = (
    await db.query("SELECT status,attempts,id,provider_id FROM notifications.deliveries WHERE event_id=$1", [
      eventId,
    ])
  ).rows[0];
  assert.equal(finished.status, "accepted");
  assert.equal(finished.attempts, 2);
  assert.equal(finished.id, stableId);
  assert.equal(finished.provider_id, "provider-confirmation");
  let sent;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.redirect, "error");
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "accepted", accepted: true }), { status: 200 });
    };
    assert.throws(() => new HttpProvider("https://user:password@provider.example/send", "secret"));
    assert.throws(() => new HttpProvider("http://provider.example/send", "secret"));
    await new HttpProvider("https://provider.example/send", "secret").send({
      id: randomUUID(),
      channel: "email",
      destination: "test@example.com",
      event: { ...event, data: { before: { secret: "private" }, after: { assigneeId: user } } },
    });
    assert.deepEqual(Object.keys(sent).sort(), ["channel", "destination", "eventType", "id"]);
    assert.equal(JSON.stringify(sent).includes("private"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  await job.remove();
  console.log("Integration: BullMQ ingestion, durable dedup, tenant/channel preferences and retry passed");
} finally {
  if (worker) await worker.close();
  await db.query("DELETE FROM notifications.deliveries WHERE organization_id IN ($1,$2)", [org, other]);
  await db.query("DELETE FROM notifications.events WHERE organization_id IN ($1,$2)", [org, other]);
  await db.query("DELETE FROM notifications.preferences WHERE organization_id IN ($1,$2)", [org, other]);
  await q.close();
  await conn.quit();
  await db.end();
}
