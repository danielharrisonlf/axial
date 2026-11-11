import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importPKCS8, SignJWT } from "jose";
import pg from "pg";

const database = process.env.TEST_DATABASE_URL,
  redis = process.env.TEST_REDIS_URL;
if (
  !database ||
  !/^\/axial_notifications_[0-9a-f]{32}_test$/.test(new URL(database).pathname) ||
  !redis ||
  !/^\/(?:[1-9]|1[0-5])$/.test(new URL(redis).pathname)
)
  throw new Error("Isolated test database and Redis required");
const dir = await mkdtemp(join(tmpdir(), "notifications-test-"));
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
await writeFile(join(dir, "public.pem"), publicKey);
const signingKey = await importPKCS8(privateKey, "RS256");
const pool = new pg.Pool({ connectionString: database });
const org = randomUUID(),
  org2 = randomUUID(),
  user = randomUUID(),
  user2 = randomUUID();
const issuer = "notifications-http-test",
  audience = "notifications-test";
async function token(sub, organizationId, options = {}) {
  return new SignJWT({ organizationId, role: "CONTRIBUTOR" })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject(sub)
    .setIssuer(options.issuer ?? issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(options.exp ?? "5m")
    .sign(signingKey);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
const servers = [];
const safeEnv = { ...process.env };
for (const key of Object.keys(safeEnv)) {
  if (
    /^(RESEND_|SMSGO_|META_|NOTIFICATIONS_PROVIDER_|NOTIFICATIONS_TRUST_|NOTIFICATIONS_VERIFY_|NOTIFICATIONS_VERIFICATION_)/.test(
      key,
    )
  )
    delete safeEnv[key];
}
async function start(redisUrl) {
  const port = await freePort();
  const processChild = spawn(process.execPath, ["dist/main.js"], {
    env: {
      ...safeEnv,
      NOTIFICATIONS_DATABASE_URL: database,
      NOTIFICATIONS_REDIS_URL: redisUrl,
      NOTIFICATIONS_PUBLIC_KEY_PATH: join(dir, "public.pem"),
      NOTIFICATIONS_JWT_ISSUER: issuer,
      NOTIFICATIONS_JWT_AUDIENCE: audience,
      NOTIFICATIONS_PORT: String(port),
      NOTIFICATIONS_PROVIDER_URL: "",
      NOTIFICATIONS_PROVIDER_TOKEN: "",
      NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION: "",
    },
    stdio: "ignore",
  });
  const closed = new Promise((resolve) => {
    processChild.once("close", resolve);
    processChild.once("error", resolve);
  });
  servers.push({ processChild, closed });
  const base = `http://127.0.0.1:${port}/api/v1/`;
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`${base}health/live`)).ok) return base;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("HTTP service did not start");
}
async function request(base, path, method = "GET", bearer, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
try {
  const base = await start(redis);
  for (let i = 0; i < 300; i++) {
    if ((await request(base, "health/ready")).status === 200) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await request(base, "health/ready")).status, 200);
  assert.equal((await request(base, "notification-preferences")).status, 401);
  assert.equal((await request(base, "notification-templates")).status, 401);
  assert.equal((await request(base, "notification-providers")).status, 401);
  assert.equal((await request(base, "notification-event-preferences")).status, 401);
  assert.equal((await request(base, "notification-preferences", "GET", "invalid")).status, 401);
  assert.equal(
    (await request(base, "notification-preferences", "GET", await token(user, org, { issuer: "wrong" })))
      .status,
    401,
  );
  assert.equal(
    (await request(base, "notification-preferences", "GET", await token(user, org, { exp: "-1m" }))).status,
    401,
  );
  const a = await token(user, org),
    b = await token(user2, org),
    c = await token(user, org2);
  const templates = await request(base, "notification-templates", "GET", a);
  assert.equal(templates.status, 200);
  assert.ok(templates.body.length > 0);
  assert.ok(templates.body.every((item) => typeof item.event === "string" && item.subject));
  const providers = await request(base, "notification-providers", "GET", a);
  assert.deepEqual(
    providers.body.map((item) => [item.channel, item.configured]),
    [
      ["email", false],
      ["sms", false],
      ["whatsapp", false],
    ],
  );
  const matrix = await request(base, "notification-event-preferences", "GET", a);
  assert.equal(matrix.body.length, templates.body.length * 3);
  assert.ok(matrix.body.every((item) => item.enabled === true));
  assert.equal(
    (
      await request(base, "notification-event-preferences/task.assigned.v1/email", "PATCH", a, {
        enabled: false,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(base, "notification-event-preferences", "GET", a)).body.find(
      (item) => item.event === "task.assigned.v1" && item.channel === "email",
    ).enabled,
    false,
  );
  assert.ok(
    (await request(base, "notification-event-preferences", "GET", b)).body.every(
      (item) => item.enabled === true,
    ),
  );
  assert.equal(
    (
      await request(base, "notification-event-preferences/other.event/email", "PATCH", a, {
        enabled: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(base, "notification-event-preferences/task.assigned.v1/letter", "PATCH", a, {
        enabled: false,
      })
    ).status,
    400,
  );
  assert.equal((await request(base, "notification-preferences/email/verification", "POST")).status, 401);
  assert.equal((await request(base, "notification-preferences/email/verification", "POST", a)).status, 503);
  assert.equal(
    (
      await request(base, "notification-preferences/email", "PATCH", a, {
        enabled: true,
        destination: "owner@example.test",
      })
    ).status,
    200,
  );
  assert.equal((await request(base, "notification-preferences", "GET", a)).body.length, 1);
  assert.equal((await request(base, "notification-preferences", "GET", b)).body.length, 0);
  assert.equal((await request(base, "notification-preferences", "GET", c)).body.length, 0);
  assert.equal(
    (
      await request(base, "notification-preferences/email", "PATCH", b, {
        enabled: true,
        destination: "second@example.test",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(base, "notification-preferences", "GET", a)).body[0].destination,
    "owner@example.test",
  );
  await pool.query(
    "UPDATE notifications.preferences SET verified_at=now() WHERE organization_id=$1 AND user_id=$2 AND channel='email'",
    [org, user],
  );
  assert.equal(
    (
      await request(base, "notification-preferences/email", "PATCH", a, {
        enabled: true,
        destination: "owner@example.test",
      })
    ).status,
    200,
  );
  assert.ok(
    (
      await pool.query(
        "SELECT verified_at FROM notifications.preferences WHERE organization_id=$1 AND user_id=$2 AND channel='email'",
        [org, user],
      )
    ).rows[0].verified_at,
  );
  assert.equal(
    (
      await request(base, "notification-preferences/email", "PATCH", a, {
        enabled: true,
        destination: "changed@example.test",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT verified_at FROM notifications.preferences WHERE organization_id=$1 AND user_id=$2 AND channel='email'",
        [org, user],
      )
    ).rows[0].verified_at,
    null,
  );
  await pool.query(
    "UPDATE notifications.preferences SET verified_at=now() WHERE organization_id=$1 AND user_id=$2 AND channel='email'",
    [org, user],
  );
  assert.equal(
    (
      await request(base, "notification-preferences/email", "PATCH", a, {
        enabled: false,
        destination: "changed@example.test",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT verified_at FROM notifications.preferences WHERE organization_id=$1 AND user_id=$2 AND channel='email'",
        [org, user],
      )
    ).rows[0].verified_at,
    null,
  );
  const eventId = randomUUID(),
    deliveryId = randomUUID();
  await pool.query("INSERT INTO notifications.events(id,organization_id,payload) VALUES($1,$2,$3)", [
    eventId,
    org,
    JSON.stringify({ type: "task.completed" }),
  ]);
  await pool.query(
    "INSERT INTO notifications.deliveries(id,event_id,organization_id,user_id,channel) VALUES($1,$2,$3,$4,'email')",
    [deliveryId, eventId, org, user],
  );
  assert.equal((await request(base, "notifications", "GET", a)).body.length, 1);
  assert.equal((await request(base, "notifications", "GET", a)).body[0].event_type, "task.completed");
  assert.equal((await request(base, "notifications", "GET", b)).body.length, 0);
  assert.equal((await request(base, "notifications", "GET", c)).body.length, 0);
  assert.equal((await request(base, `notifications/${deliveryId}`, "GET", a)).status, 200);
  assert.equal((await request(base, `notifications/${deliveryId}`, "GET", b)).status, 404);
  assert.equal((await request(base, `notifications/${deliveryId}/retry`, "POST", b)).status, 404);
  assert.equal((await request(base, `notifications/${deliveryId}/retry`, "POST", c)).status, 404);
  assert.equal((await request(base, `notifications/${deliveryId}/retry`, "POST", a)).status, 201);
  await pool.query("UPDATE notifications.deliveries SET status='accepted' WHERE id=$1", [deliveryId]);
  assert.equal((await request(base, `notifications/${deliveryId}/retry`, "POST", a)).status, 409);
  await pool.query("UPDATE notifications.deliveries SET status='unknown' WHERE id=$1", [deliveryId]);
  assert.equal((await request(base, `notifications/${deliveryId}/retry`, "POST", a)).status, 409);
  const deadPort = await freePort();
  const offline = await start(`redis://127.0.0.1:${deadPort}/14`);
  assert.equal((await request(offline, "health/live")).status, 200);
  assert.equal((await request(offline, "health/ready")).status, 503);
  console.log("HTTP: signed JWT, isolation, safe retry and Redis readiness passed");
} finally {
  for (const { processChild } of servers) processChild.kill();
  for (const { closed } of servers) await closed;
  await pool.end();
  await rm(dir, { recursive: true, force: true });
}
