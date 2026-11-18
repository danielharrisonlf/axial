import { fileURLToPath } from "node:url";
import { assertValidFixtures, buildDemoFixtures } from "@axial/demo-fixtures";
import { config as loadEnv } from "dotenv";
import { Pool } from "pg";
import { seedAuditEvents } from "./demo-seed.js";

/**
 * History of the fictional Vetor Labs/Atlas scenario (packages/demo-fixtures) in ms-audit.
 * `tsx src/seed-demo.ts` writes AUDIT_DATABASE_URL and requires a *_dev database;
 * `tsx src/seed-demo.ts --test` writes AUDIT_TEST_DATABASE_URL and requires a *_test database.
 * Both refuse NODE_ENV=production. Run after the projects seed (identity → projects → audit).
 * Writes only on the first run; later runs report "already seeded", and divergences from the
 * scenario are listed in `warnings` without failing (exit code 0).
 */
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
if (process.env.NODE_ENV === "production") throw new Error("Demo seed cannot run in production");
const test = process.argv.includes("--test");
const variable = test ? "AUDIT_TEST_DATABASE_URL" : "AUDIT_DATABASE_URL";
const suffix = test ? "_test" : "_dev";
const url = process.env[variable];
if (!url) throw new Error(`${variable} is required`);
const databaseName = decodeURIComponent(new URL(url).pathname.slice(1).split("/")[0] ?? "");
if (!databaseName.endsWith(suffix))
  throw new Error(`Demo seed requires an explicitly named *${suffix} database in ${variable}`);

const fixtures = buildDemoFixtures();
assertValidFixtures(fixtures);
const pool = new Pool({ connectionString: url, max: 1 });
try {
  const report = await seedAuditEvents(pool, fixtures.auditEvents);
  const excluded = fixtures.excluded.filter((item) => item.kind === "audit");
  console.log(JSON.stringify({ seed: "audit", database: databaseName, ...report, excluded }, null, 2));
  console.log(
    report.status === "already seeded"
      ? "Demo audit history already seeded: nothing written."
      : "Demo audit history seeded. Later runs write nothing.",
  );
} finally {
  await pool.end();
}
