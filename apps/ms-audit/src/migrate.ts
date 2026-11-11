import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const { db } = await import("./db.js");

const migrations = ["001_initial"];
const c = await db.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(hashtext('axial-audit-migrate'))");
  await c.query("CREATE SCHEMA IF NOT EXISTS audit");
  await c.query("CREATE TABLE IF NOT EXISTS audit.schema_migrations(id text PRIMARY KEY)");
  for (const id of migrations) {
    const existing = await c.query("SELECT 1 FROM audit.schema_migrations WHERE id=$1", [id]);
    if (!existing.rowCount) {
      await c.query(await readFile(new URL(`../migrations/${id}.sql`, import.meta.url), "utf8"));
      await c.query("INSERT INTO audit.schema_migrations VALUES ($1)", [id]);
    }
  }
  await c.query("COMMIT");
} catch (error) {
  await c.query("ROLLBACK");
  throw error;
} finally {
  c.release();
  await db.end();
}
