import { fileURLToPath } from "node:url";
import { assertValidFixtures, buildDemoFixtures } from "@axial/demo-fixtures";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { seedProjects } from "./demo-seed.js";

/**
 * Fictional Vetor Labs/Atlas scenario of ms-projects (packages/demo-fixtures).
 * `tsx prisma/seed.ts` writes DATABASE_URL and requires a *_dev database;
 * `tsx prisma/seed.ts --test` writes TEST_DATABASE_URL and requires a *_test database.
 * Both refuse NODE_ENV=production. Order with the other seeds: identity → projects → audit.
 * Each project is written once; later runs report "already seeded", and divergences from the
 * scenario are listed in `warnings` without failing (exit code 0).
 */
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
if (process.env.NODE_ENV === "production") throw new Error("Demo seed cannot run in production");
const test = process.argv.includes("--test");
const variable = test ? "TEST_DATABASE_URL" : "DATABASE_URL";
const suffix = test ? "_test" : "_dev";
const url = process.env[variable];
if (!url) throw new Error(`${variable} is required`);
const databaseName = decodeURIComponent(new URL(url).pathname.slice(1).split("/")[0] ?? "");
if (!databaseName.endsWith(suffix))
  throw new Error(`Demo seed requires an explicitly named *${suffix} database in ${variable}`);

const fixtures = buildDemoFixtures();
assertValidFixtures(fixtures);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
try {
  const report = await seedProjects(db, fixtures);
  console.log(
    JSON.stringify(
      { seed: "projects", database: databaseName, ...report, excluded: fixtures.excluded },
      null,
      2,
    ),
  );
  console.log(
    report.status === "already seeded"
      ? "Demo projects already seeded: nothing written."
      : "Demo projects seeded. Later runs write nothing for projects that exist.",
  );
} finally {
  await db.$disconnect();
}
