import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("TEST_DATABASE_URL must name a _test database");
const name = `axial_notifications_${randomUUID().replaceAll("-", "")}_test`;
const testUrl = new URL(url);
testUrl.pathname = `/${name}`;
const admin = new pg.Pool({ connectionString: url });
const safeEnv = { ...process.env };
for (const key of Object.keys(safeEnv)) {
  if (
    /^(RESEND_|SMSGO_|META_|NOTIFICATIONS_PROVIDER_|NOTIFICATIONS_TRUST_|NOTIFICATIONS_VERIFY_|NOTIFICATIONS_VERIFICATION_)/.test(
      key,
    )
  )
    delete safeEnv[key];
}
let created = false;
async function cleanup() {
  try {
    if (!created) return;
    for (let i = 0; i < 100; i++) {
      const result = await admin.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1",
        [name],
      );
      if (result.rows[0].count === 0) {
        await admin.query(`DROP DATABASE "${name}"`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Open connections to ${name}; database retained`);
  } finally {
    await admin.end();
  }
}
let failure;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  for (const file of ["test/integration.mjs", "test/http.mjs", "test/verification.mjs"]) {
    const result = spawnSync(process.execPath, [file], {
      env: { ...safeEnv, TEST_DATABASE_URL: testUrl.toString() },
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`${file} failed`);
  }
} catch (error) {
  failure = error;
}
try {
  await cleanup();
} catch (error) {
  if (failure) throw new AggregateError([failure, error], "Test and cleanup failed");
  throw error;
}
if (failure) throw failure;
