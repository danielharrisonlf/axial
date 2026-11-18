import { fileURLToPath } from "node:url";
import {
  memberships,
  organizations,
  projectAssignments,
  teamMemberships,
  teams,
  users,
} from "@axial/demo-fixtures";
import { config as loadEnv } from "dotenv";
import { Pool } from "pg";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, password } from "./common.js";
import { seedIdentity } from "./demo-seed.js";

/**
 * Directory of the fictional Vetor Labs/Atlas scenario (packages/demo-fixtures) in ms-identity.
 * `tsx src/seed-demo.ts` writes IDENTITY_DATABASE_URL and requires a *_dev database;
 * `tsx src/seed-demo.ts --test` writes IDENTITY_TEST_DATABASE_URL and requires a *_test database.
 * Both refuse NODE_ENV=production and require AXIAL_DEMO_PASSWORD, the password of every seeded
 * account (a development fixture supplied by the environment, never committed). Runs first:
 * identity → projects → audit. Writes only on the first run; later runs report "already seeded",
 * and divergences from the scenario are listed in `warnings` without failing (exit code 0).
 */
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
if (process.env.NODE_ENV === "production") throw new Error("Demo seed cannot run in production");
const test = process.argv.includes("--test");
const variable = test ? "IDENTITY_TEST_DATABASE_URL" : "IDENTITY_DATABASE_URL";
const suffix = test ? "_test" : "_dev";
const url = process.env[variable];
if (!url) throw new Error(`${variable} is required`);
const databaseName = decodeURIComponent(new URL(url).pathname.slice(1).split("/")[0] ?? "");
if (!databaseName.endsWith(suffix))
  throw new Error(`Demo seed requires an explicitly named *${suffix} database in ${variable}`);
const demoPassword = password.safeParse(process.env.AXIAL_DEMO_PASSWORD);
if (!demoPassword.success)
  throw new Error(
    `AXIAL_DEMO_PASSWORD is required for the identity demo seed (${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters)`,
  );

const pool = new Pool({ connectionString: url, max: 1 });
try {
  const report = await seedIdentity(
    pool,
    { organizations, users, teams, memberships, teamMemberships, projectAssignments },
    demoPassword.data,
  );
  console.log(JSON.stringify({ seed: "identity", database: databaseName, ...report }, null, 2));
  console.log(
    report.status === "already seeded"
      ? "Demo identity directory already seeded: nothing written."
      : "Demo identity directory seeded. Later runs write nothing.",
  );
} finally {
  await pool.end();
}
