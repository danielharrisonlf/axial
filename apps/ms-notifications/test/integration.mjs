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
const { startConsumer, ingest, dispatchOne, HttpProvider, configuredProvider } = await import(
  "../dist/consumer.js"
);
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
  await db.query(
    "UPDATE notifications.preferences SET verified_at=now() WHERE organization_id=$1 AND user_id=$2 AND channel='email'",
    [org, user],
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
  // A disabled channel ahead of a configured one must not block it.
  await db.query(
    "UPDATE notifications.preferences SET enabled=true WHERE organization_id=$1 AND user_id=$2 AND channel='sms'",
    [org, user],
  );
  await db.query(
    "INSERT INTO notifications.deliveries(id,event_id,organization_id,user_id,channel,created_at) VALUES($1,$2,$3,$4,'sms',now()-interval '1 minute')",
    [randomUUID(), eventId, org, user],
  );
  const configKeys = [
    "NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION",
    "NOTIFICATIONS_PROVIDER_URL",
    "NOTIFICATIONS_PROVIDER_TOKEN",
    "RESEND_API_KEY",
    "RESEND_FROM",
    "SMSGO_API_KEY",
    "SMSGO_SMS_TYPE_ID",
    "META_ACCESS_TOKEN",
    "META_PHONE_NUMBER_ID",
    "META_TEMPLATE_NAME",
    "META_LANGUAGE_CODE",
    "META_GRAPH_VERSION",
  ];
  const savedEnv = { ...process.env };
  try {
    for (const key of configKeys) delete process.env[key];
    process.env.RESEND_API_KEY = "secret-do-not-expose";
    assert.throws(
      () => configuredProvider(),
      (error) =>
        /Incomplete provider configuration/.test(error.message) &&
        !error.message.includes("secret-do-not-expose"),
    );
    process.env.RESEND_FROM = "sender@example.test";
    process.env.META_ACCESS_TOKEN = "secret-do-not-expose";
    assert.throws(
      () => configuredProvider(),
      (error) =>
        /Incomplete provider configuration/.test(error.message) &&
        !error.message.includes("secret-do-not-expose"),
    );
    process.env.META_PHONE_NUMBER_ID = "123";
    process.env.META_TEMPLATE_NAME = "notice";
    process.env.META_LANGUAGE_CODE = "pt_BR";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION = "true";
    assert.deepEqual(configuredProvider().channels, ["email", "whatsapp"]);
    for (const key of configKeys) delete process.env[key];
    process.env.NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION = "true";
    assert.deepEqual(configuredProvider().channels, []);
    process.env.SMSGO_API_KEY = "test-key";
    assert.throws(() => configuredProvider(), /Incomplete provider configuration/);
    process.env.SMSGO_SMS_TYPE_ID = "0";
    assert.throws(() => configuredProvider(), /Invalid SMSGO_SMS_TYPE_ID/);
    process.env.SMSGO_SMS_TYPE_ID = "2";
    const direct = configuredProvider();
    assert.deepEqual(direct.channels, ["sms"]);
    assert.equal(await dispatchOne(direct), false); // Trust alone cannot authorize an unverified contact.
  } finally {
    for (const key of configKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
  await db.query(
    "UPDATE notifications.preferences SET verified_at=now() WHERE organization_id=$1 AND user_id=$2 AND channel='sms'",
    [org, user],
  );
  let stableId;
  assert.equal(
    await dispatchOne({
      channels: ["email"],
      send: async (input) => {
        stableId = input.id;
        return "provider-confirmation";
      },
    }),
    true,
  );
  const finished = (
    await db.query(
      "SELECT status,attempts,id,provider_id FROM notifications.deliveries WHERE event_id=$1 AND channel='email'",
      [eventId],
    )
  ).rows[0];
  assert.equal(finished.status, "accepted");
  assert.equal(finished.attempts, 1);
  assert.equal(finished.id, stableId);
  assert.equal(finished.provider_id, "provider-confirmation");
  assert.equal(
    await dispatchOne({
      channels: ["email"],
      send: async () => {
        throw new Error("must not send");
      },
    }),
    false,
  );
  assert.equal(
    await dispatchOne({
      channels: ["sms"],
      send: async () => {
        throw new Error("timeout");
      },
    }),
    true,
  );
  assert.equal(
    (
      await db.query("SELECT status FROM notifications.deliveries WHERE event_id=$1 AND channel='sms'", [
        eventId,
      ])
    ).rows[0].status,
    "unknown",
  );
  assert.equal(
    await dispatchOne({
      channels: ["sms"],
      send: async () => {
        throw new Error("must not retry");
      },
    }),
    false,
  );
  await db.query(
    "UPDATE notifications.deliveries SET status='sending',lease_until=now()-interval '1 minute' WHERE event_id=$1 AND channel='sms'",
    [eventId],
  );
  assert.equal(
    await dispatchOne({
      channels: ["sms"],
      send: async () => {
        throw new Error("must not retry lease");
      },
    }),
    false,
  );
  assert.equal(
    (
      await db.query("SELECT status FROM notifications.deliveries WHERE event_id=$1 AND channel='sms'", [
        eventId,
      ])
    ).rows[0].status,
    "unknown",
  );
  await db.query("UPDATE notifications.deliveries SET status='pending' WHERE event_id=$1 AND channel='sms'", [
    eventId,
  ]);
  await db.query(
    "UPDATE notifications.preferences SET enabled=false WHERE organization_id=$1 AND user_id=$2 AND channel='sms'",
    [org, user],
  );
  assert.equal(
    await dispatchOne({
      channels: ["sms"],
      send: async () => {
        throw new Error("must not send opt-out");
      },
    }),
    false,
  );
  const savedTrust = process.env.NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION;
  delete process.env.NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION;
  assert.equal(configuredProvider(), undefined);
  if (savedTrust === undefined) delete process.env.NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION;
  else process.env.NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION = savedTrust;
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
  console.log(
    "Integration: BullMQ ingestion, durable dedup, tenant/channel preferences and uncertain outcomes passed",
  );
} finally {
  if (worker) await worker.close();
  await db.query("DELETE FROM notifications.deliveries WHERE organization_id IN ($1,$2)", [org, other]);
  await db.query("DELETE FROM notifications.events WHERE organization_id IN ($1,$2)", [org, other]);
  await db.query("DELETE FROM notifications.preferences WHERE organization_id IN ($1,$2)", [org, other]);
  await q.close();
  await conn.quit();
  await db.end();
}
