import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";

type Actor = { sub: string; organizationId: string };
type Channel = "email" | "sms" | "whatsapp";
export class VerificationUnavailableError extends Error {}
function pepper(): Buffer {
  const value = process.env.NOTIFICATIONS_VERIFICATION_PEPPER;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new VerificationUnavailableError("Verification unavailable");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value)
    throw new VerificationUnavailableError("Verification unavailable");
  return decoded;
}
function mac(value: string): Buffer {
  return createHmac("sha256", pepper()).update(value).digest();
}
function digest(actor: Actor, channel: Channel, destination: string, code: string): Buffer {
  return mac(JSON.stringify(["otp", actor.organizationId, actor.sub, channel, destination, code]));
}
function configured(channel: Channel): boolean {
  const e = process.env;
  if (channel === "email")
    return e.NOTIFICATIONS_VERIFY_EMAIL === "true" && !!e.RESEND_API_KEY && !!e.RESEND_FROM;
  if (channel === "sms")
    return (
      e.NOTIFICATIONS_VERIFY_SMS === "true" &&
      !!e.SMSGO_API_KEY &&
      /^[1-9]\d*$/.test(e.SMSGO_VERIFICATION_SMS_TYPE_ID ?? "") &&
      Number.isSafeInteger(Number(e.SMSGO_VERIFICATION_SMS_TYPE_ID))
    );
  return (
    e.NOTIFICATIONS_VERIFY_WHATSAPP === "true" &&
    !!e.META_ACCESS_TOKEN &&
    /^\d+$/.test(e.META_PHONE_NUMBER_ID ?? "") &&
    !!e.META_VERIFICATION_TEMPLATE_NAME &&
    !!e.META_VERIFICATION_LANGUAGE_CODE &&
    /^v\d+\.\d+$/.test(e.META_GRAPH_VERSION ?? "") &&
    ["body", "copy_code"].includes(e.META_VERIFICATION_TEMPLATE_MODE ?? "")
  );
}
async function send(channel: Channel, destination: string, code: string): Promise<void> {
  const e = process.env;
  const options = { method: "POST", redirect: "error" as const, signal: AbortSignal.timeout(10000) };
  let response: Response;
  if (channel === "email") {
    response = await fetch("https://api.resend.com/emails", {
      ...options,
      headers: {
        authorization: `Bearer ${e.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        from: e.RESEND_FROM,
        to: [destination],
        subject: "Código de verificação Axial",
        text: `Seu código de verificação Axial é ${code}. Ele expira em 10 minutos.`,
      }),
    });
  } else if (channel === "sms") {
    const auth = await fetch("https://api.smsgo.com.br/v1/auth/token", {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { "SMSGo-key": e.SMSGO_API_KEY! },
    });
    if (!auth.ok) throw new Error("Verification send failed");
    const result: unknown = await auth.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("token" in result) ||
      typeof result.token !== "string" ||
      !result.token ||
      /[\r\n]/.test(result.token)
    )
      throw new Error("Verification send failed");
    response = await fetch("https://api.smsgo.com.br/v1/sms/send/single", {
      ...options,
      headers: { authorization: `Bearer ${result.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        phone: destination,
        message: `Axial: seu codigo de verificacao e ${code}. Valido por 10 minutos.`,
        reference: randomUUID(),
        sms_type_id: Number(e.SMSGO_VERIFICATION_SMS_TYPE_ID),
      }),
    });
  } else {
    const components: object[] = [{ type: "body", parameters: [{ type: "text", text: code }] }];
    if (e.META_VERIFICATION_TEMPLATE_MODE === "copy_code")
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: code }],
      });
    response = await fetch(
      `https://graph.facebook.com/${e.META_GRAPH_VERSION}/${e.META_PHONE_NUMBER_ID}/messages`,
      {
        ...options,
        headers: { authorization: `Bearer ${e.META_ACCESS_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: destination,
          type: "template",
          template: {
            name: e.META_VERIFICATION_TEMPLATE_NAME,
            language: { code: e.META_VERIFICATION_LANGUAGE_CODE },
            components,
          },
        }),
      },
    );
  }
  if (!response.ok) throw new Error("Verification send failed");
}
async function limits(c: import("pg").PoolClient, actor: Actor, channel: Channel, destination: string) {
  const keys = [
    ["user", mac(`user:${actor.sub}`)],
    ["destination", mac(`destination:${channel === "email" ? destination.toLowerCase() : destination}`)],
  ] as const;
  for (const [kind, key] of keys) {
    await c.query(
      "INSERT INTO notifications.verification_limits(kind,key_digest) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [kind, key],
    );
    await c.query(
      "SELECT 1 FROM notifications.verification_limits WHERE kind=$1 AND key_digest=$2 FOR UPDATE",
      [kind, key],
    );
    await c.query(
      "UPDATE notifications.verification_limits SET sends=0,attempts=0,window_start=now() WHERE kind=$1 AND key_digest=$2 AND window_start<=now()-interval '1 hour'",
      [kind, key],
    );
  }
  return keys;
}
export async function beginVerification(actor: Actor, channel: Channel): Promise<void> {
  pepper();
  if (!configured(channel)) throw new VerificationUnavailableError("Verification unavailable");
  const c = await db.connect();
  let delivery: { destination: string; code: string } | undefined;
  try {
    await c.query("BEGIN");
    const pref = await c.query<{ destination: string }>(
      "SELECT destination FROM notifications.preferences WHERE organization_id=$1 AND user_id=$2 AND channel=$3 AND enabled AND verified_at IS NULL FOR UPDATE",
      [actor.organizationId, actor.sub, channel],
    );
    if (pref.rowCount) {
      const destination = pref.rows[0]!.destination;
      const keys = await limits(c, actor, channel, destination);
      let allowed = true;
      for (const [kind, key] of keys) {
        const result = await c.query(
          "SELECT 1 FROM notifications.verification_limits WHERE kind=$1 AND key_digest=$2 AND sends<3 AND attempts<10 AND (last_send IS NULL OR last_send<=now()-interval '1 minute')",
          [kind, key],
        );
        if (!result.rowCount) allowed = false;
      }
      if (allowed) {
        const code = randomInt(0, 1000000).toString().padStart(6, "0");
        await c.query(
          "INSERT INTO notifications.verification_challenges(organization_id,user_id,channel,destination,digest,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes') ON CONFLICT(organization_id,user_id,channel) DO UPDATE SET destination=EXCLUDED.destination,digest=EXCLUDED.digest,expires_at=EXCLUDED.expires_at,attempts=0,consumed_at=NULL",
          [actor.organizationId, actor.sub, channel, destination, digest(actor, channel, destination, code)],
        );
        for (const [kind, key] of keys)
          await c.query(
            "UPDATE notifications.verification_limits SET sends=sends+1,last_send=now() WHERE kind=$1 AND key_digest=$2",
            [kind, key],
          );
        delivery = { destination, code };
      }
    }
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
  if (delivery) {
    try {
      await send(channel, delivery.destination, delivery.code);
    } catch {
      /* ambiguous outcome is never retried */
    }
  }
}
export async function confirmVerification(actor: Actor, channel: Channel, code: string): Promise<boolean> {
  pepper();
  const c = await db.connect();
  let success = false;
  try {
    await c.query("BEGIN");
    const pref = await c.query<{ destination: string }>(
      "SELECT destination FROM notifications.preferences WHERE organization_id=$1 AND user_id=$2 AND channel=$3 AND enabled AND verified_at IS NULL FOR UPDATE",
      [actor.organizationId, actor.sub, channel],
    );
    if (pref.rowCount) {
      const destination = pref.rows[0]!.destination;
      const keys = await limits(c, actor, channel, destination);
      let allowed = true;
      for (const [kind, key] of keys) {
        const result = await c.query(
          "SELECT 1 FROM notifications.verification_limits WHERE kind=$1 AND key_digest=$2 AND attempts<10",
          [kind, key],
        );
        if (!result.rowCount) allowed = false;
      }
      const challenge = await c.query<{ digest: Buffer }>(
        "SELECT digest FROM notifications.verification_challenges WHERE organization_id=$1 AND user_id=$2 AND channel=$3 AND destination=$4 AND consumed_at IS NULL AND expires_at>now() AND attempts<5 FOR UPDATE",
        [actor.organizationId, actor.sub, channel, destination],
      );
      if (allowed && challenge.rowCount) {
        for (const [kind, key] of keys)
          await c.query(
            "UPDATE notifications.verification_limits SET attempts=attempts+1 WHERE kind=$1 AND key_digest=$2",
            [kind, key],
          );
        await c.query(
          "UPDATE notifications.verification_challenges SET attempts=attempts+1 WHERE organization_id=$1 AND user_id=$2 AND channel=$3",
          [actor.organizationId, actor.sub, channel],
        );
        const expected = challenge.rows[0]!.digest;
        const actual = digest(actor, channel, destination, code);
        if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
          await c.query(
            "UPDATE notifications.verification_challenges SET consumed_at=now() WHERE organization_id=$1 AND user_id=$2 AND channel=$3",
            [actor.organizationId, actor.sub, channel],
          );
          await c.query(
            "UPDATE notifications.preferences SET verified_at=now(),updated_at=now() WHERE organization_id=$1 AND user_id=$2 AND channel=$3 AND destination=$4 AND enabled",
            [actor.organizationId, actor.sub, channel, destination],
          );
          success = true;
        }
      }
    }
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
  return success;
}
