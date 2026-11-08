import { readFile } from "node:fs/promises";
import { pool } from "./db.js";

const db = pool();
try {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('axial-identity-migrate'))");
    await client.query("CREATE SCHEMA IF NOT EXISTS identity");
    await client.query("CREATE TABLE IF NOT EXISTS identity.schema_migrations (id text PRIMARY KEY)");
    for (const id of ["001_initial", "002_password_activation"]) {
      const exists = await client.query("SELECT 1 FROM identity.schema_migrations WHERE id=$1", [id]);
      if (!exists.rowCount) {
        const sql = await readFile(new URL(`../migrations/${id}.sql`, import.meta.url), "utf8");
        await client.query(sql);
        await client.query("INSERT INTO identity.schema_migrations VALUES ($1)", [id]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await db.end();
}
