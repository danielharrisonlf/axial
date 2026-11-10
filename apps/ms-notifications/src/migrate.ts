import { readFile } from "node:fs/promises";
import { db } from "./db.js";

const c = await db.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(hashtext('axial-notifications-migrate'))");
  await c.query("CREATE SCHEMA IF NOT EXISTS notifications");
  await c.query("CREATE TABLE IF NOT EXISTS notifications.schema_migrations(id text PRIMARY KEY)");
  for (const id of ["001_initial", "002_unknown"]) {
    const existing = await c.query("SELECT 1 FROM notifications.schema_migrations WHERE id=$1", [id]);
    if (!existing.rowCount) {
      await c.query(await readFile(new URL(`../migrations/${id}.sql`, import.meta.url), "utf8"));
      await c.query("INSERT INTO notifications.schema_migrations VALUES ($1)", [id]);
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
