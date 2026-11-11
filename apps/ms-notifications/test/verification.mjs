import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

for (const key of Object.keys(process.env)) {
  if (
    /^(RESEND_|SMSGO_|META_|NOTIFICATIONS_PROVIDER_|NOTIFICATIONS_TRUST_|NOTIFICATIONS_VERIFY_|NOTIFICATIONS_VERIFICATION_)/.test(
      key,
    )
  )
    delete process.env[key];
}
const url = process.env.TEST_DATABASE_URL;
if (!url || !/^\/axial_notifications_[0-9a-f]{32}_test$/.test(new URL(url).pathname))
  throw new Error("Isolated database required");
process.env.NOTIFICATIONS_DATABASE_URL = url;
process.env.NOTIFICATIONS_VERIFICATION_PEPPER = randomBytes(32).toString("base64");
process.env.NOTIFICATIONS_VERIFY_EMAIL = "true";
process.env.RESEND_API_KEY = "fake-key";
process.env.RESEND_FROM = "sender@example.test";
const { db } = await import("../dist/db.js");
const { beginVerification, confirmVerification } = await import("../dist/verification.js");
const calls = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "https://api.resend.com/emails");
  calls.push(JSON.parse(options.body));
  return new Response("{}", { status: 200 });
};
async function preference(actor, destination) {
  await db.query(
    "INSERT INTO notifications.preferences(organization_id,user_id,channel,enabled,destination) VALUES($1,$2,'email',true,$3)",
    [actor.organizationId, actor.sub, destination],
  );
}
const actor = { organizationId: randomUUID(), sub: randomUUID() };
try {
  await preference(actor, "proof@example.test");
  await beginVerification(actor, "email");
  assert.equal(calls.length, 1);
  const code = calls[0].text.match(/\b\d{6}\b/)[0];
  const stored = await db.query("SELECT * FROM notifications.verification_challenges WHERE user_id=$1", [
    actor.sub,
  ]);
  assert.equal(JSON.stringify(stored.rows).includes(code), false);
  assert.equal(await confirmVerification({ ...actor, organizationId: randomUUID() }, "email", code), false);
  assert.equal(await confirmVerification(actor, "email", "xxxxxx"), false);
  const concurrent = await Promise.all([
    confirmVerification(actor, "email", code),
    confirmVerification(actor, "email", code),
  ]);
  assert.equal(concurrent.filter(Boolean).length, 1);
  assert.equal(await confirmVerification(actor, "email", code), false);
  const changed = { organizationId: randomUUID(), sub: randomUUID() };
  await preference(changed, "old@example.test");
  await beginVerification(changed, "email");
  const old = calls.at(-1).text.match(/\b\d{6}\b/)[0];
  await db.query(
    "UPDATE notifications.preferences SET destination='new@example.test' WHERE organization_id=$1 AND user_id=$2",
    [changed.organizationId, changed.sub],
  );
  await db.query(
    "UPDATE notifications.preferences SET destination='old@example.test' WHERE organization_id=$1 AND user_id=$2",
    [changed.organizationId, changed.sub],
  );
  assert.equal(await confirmVerification(changed, "email", old), false);
  const expired = { organizationId: randomUUID(), sub: randomUUID() };
  await preference(expired, "expiry@example.test");
  await beginVerification(expired, "email");
  const expCode = calls.at(-1).text.match(/\b\d{6}\b/)[0];
  await db.query(
    "UPDATE notifications.verification_challenges SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [expired.sub],
  );
  assert.equal(await confirmVerification(expired, "email", expCode), false);
  const limited = { organizationId: randomUUID(), sub: randomUUID() };
  await preference(limited, "limits@example.test");
  await Promise.all(Array.from({ length: 5 }, () => beginVerification(limited, "email")));
  assert.equal(calls.filter((x) => x.to[0] === "limits@example.test").length, 1);
  const before = calls.length;
  const sameDestination = { organizationId: randomUUID(), sub: randomUUID() };
  await preference(sameDestination, "limits@example.test");
  await beginVerification(sameDestination, "email");
  assert.equal(calls.length, before);
  const bad = calls.at(-1).text.match(/\b\d{6}\b/)[0] === "999999" ? "888888" : "999999";
  for (let i = 0; i < 6; i++) assert.equal(await confirmVerification(limited, "email", bad), false);
  const attempts = await db.query(
    "SELECT attempts FROM notifications.verification_challenges WHERE user_id=$1",
    [limited.sub],
  );
  assert.equal(attempts.rows[0].attempts, 5);
  // Both actors have preferences and challenges; a code belongs to its own actor.
  const first = { organizationId: randomUUID(), sub: randomUUID() };
  const second = { organizationId: first.organizationId, sub: randomUUID() };
  await preference(first, "first-isolation@example.test");
  await preference(second, "second-isolation@example.test");
  await beginVerification(first, "email");
  const firstCode = calls.at(-1).text.match(/\b\d{6}\b/)[0];
  await beginVerification(second, "email");
  let secondCode = calls.at(-1).text.match(/\b\d{6}\b/)[0];
  // Avoid a one-in-a-million collision creating a flaky test.
  if (secondCode === firstCode) {
    secondCode = firstCode === "000000" ? "000001" : "000000";
    const digest = createHmac("sha256", Buffer.from(process.env.NOTIFICATIONS_VERIFICATION_PEPPER, "base64"))
      .update(
        JSON.stringify([
          "otp",
          second.organizationId,
          second.sub,
          "email",
          "second-isolation@example.test",
          secondCode,
        ]),
      )
      .digest();
    await db.query(
      "UPDATE notifications.verification_challenges SET digest=$1 WHERE organization_id=$2 AND user_id=$3 AND channel='email'",
      [digest, second.organizationId, second.sub],
    );
  }
  assert.equal(await confirmVerification(second, "email", firstCode), false);
  assert.equal(await confirmVerification(first, "email", firstCode), true);
  assert.equal(await confirmVerification(second, "email", secondCode), true);

  const quota = { organizationId: randomUUID(), sub: randomUUID() };
  const quotaDestination = "quota@example.test";
  await preference(quota, quotaDestination);
  const pepper = Buffer.from(process.env.NOTIFICATIONS_VERIFICATION_PEPPER, "base64");
  const limitKeys = [`user:${quota.sub}`, `destination:${quotaDestination}`].map((value) =>
    createHmac("sha256", pepper).update(value).digest(),
  );
  const sendsToQuota = () => calls.filter((call) => call.to[0] === quotaDestination).length;
  for (let i = 0; i < 3; i++) {
    await beginVerification(quota, "email");
    assert.equal(sendsToQuota(), i + 1);
    await db.query(
      "UPDATE notifications.verification_limits SET last_send=now()-interval '2 minutes' WHERE key_digest=ANY($1::bytea[])",
      [limitKeys],
    );
  }
  await beginVerification(quota, "email");
  assert.equal(sendsToQuota(), 3);
  await db.query(
    "UPDATE notifications.verification_limits SET window_start=now()-interval '61 minutes' WHERE key_digest=ANY($1::bytea[])",
    [limitKeys],
  );
  await beginVerification(quota, "email");
  assert.equal(sendsToQuota(), 4);
  process.env.NOTIFICATIONS_VERIFICATION_PEPPER = "weak";
  await assert.rejects(beginVerification(actor, "email"), /Verification unavailable/);
  process.env.NOTIFICATIONS_VERIFICATION_PEPPER = randomBytes(32).toString("base64");
  delete process.env.NOTIFICATIONS_VERIFY_EMAIL;
  await assert.rejects(beginVerification(actor, "email"), /Verification unavailable/);
  process.env.NOTIFICATIONS_VERIFY_WHATSAPP = "true";
  process.env.META_ACCESS_TOKEN = "fake";
  process.env.META_PHONE_NUMBER_ID = "123";
  process.env.META_GRAPH_VERSION = "v20.0";
  process.env.META_VERIFICATION_TEMPLATE_NAME = "verification_only";
  process.env.META_VERIFICATION_LANGUAGE_CODE = "pt_BR";
  process.env.META_VERIFICATION_TEMPLATE_MODE = "copy_code";
  const meta = { organizationId: randomUUID(), sub: randomUUID() };
  await db.query(
    "INSERT INTO notifications.preferences(organization_id,user_id,channel,enabled,destination) VALUES($1,$2,'whatsapp',true,'+15555550123')",
    [meta.organizationId, meta.sub],
  );
  let metaPayload;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://graph.facebook.com/v20.0/123/messages");
    metaPayload = JSON.parse(options.body);
    return new Response("{}", { status: 200 });
  };
  await beginVerification(meta, "whatsapp");
  assert.equal(metaPayload.template.name, "verification_only");
  assert.equal(metaPayload.template.components[1].sub_type, "url");
  assert.equal(
    metaPayload.template.components[0].parameters[0].text,
    metaPayload.template.components[1].parameters[0].text,
  );
  process.env.NOTIFICATIONS_VERIFY_SMS = "true";
  process.env.SMSGO_API_KEY = "fake";
  process.env.SMSGO_SMS_TYPE_ID = "7";
  const sms = { organizationId: randomUUID(), sub: randomUUID() };
  await db.query(
    "INSERT INTO notifications.preferences(organization_id,user_id,channel,enabled,destination) VALUES($1,$2,'sms',true,'+15555550124')",
    [sms.organizationId, sms.sub],
  );
  await assert.rejects(beginVerification(sms, "sms"), /Verification unavailable/);
  process.env.SMSGO_VERIFICATION_SMS_TYPE_ID = "0";
  await assert.rejects(beginVerification(sms, "sms"), /Verification unavailable/);
  process.env.SMSGO_VERIFICATION_SMS_TYPE_ID = "9";
  let smsPayload;
  globalThis.fetch = async (url, options) => {
    if (url === "https://api.smsgo.com.br/v1/auth/token") {
      return new Response(JSON.stringify({ token: "fake-token" }), { status: 200 });
    }
    assert.equal(url, "https://api.smsgo.com.br/v1/sms/send/single");
    smsPayload = JSON.parse(options.body);
    return new Response("{}", { status: 200 });
  };
  await beginVerification(sms, "sms");
  assert.equal(smsPayload.sms_type_id, 9);
  assert.match(smsPayload.message, /\b\d{6}\b/);
  console.log("Verification integration passed");
} finally {
  await db.end();
}
