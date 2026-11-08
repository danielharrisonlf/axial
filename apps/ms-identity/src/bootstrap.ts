import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "./db.js";
import { hashPassword } from "./password.js";

const input = z
  .object({
    IDENTITY_BOOTSTRAP_EMAIL: z.email().max(254),
    IDENTITY_BOOTSTRAP_PASSWORD: z.string().min(14).max(128),
    IDENTITY_BOOTSTRAP_ORGANIZATION: z.string().trim().min(1).max(120),
  })
  .parse(process.env);
const db = pool();
try {
  const passwordHash = await hashPassword(input.IDENTITY_BOOTSTRAP_PASSWORD);
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext('axial-identity-bootstrap'))");
    const existing = await c.query("SELECT 1 FROM identity.organizations LIMIT 1");
    if (existing.rowCount) throw new Error("Bootstrap denied: identity already contains an organization");
    const user = randomUUID(),
      org = randomUUID();
    await c.query(
      "INSERT INTO identity.users(id,email,password_hash,must_change_password) VALUES($1,$2,$3,false)",
      [user, input.IDENTITY_BOOTSTRAP_EMAIL.toLowerCase(), passwordHash],
    );
    await c.query("INSERT INTO identity.organizations(id,name) VALUES($1,$2)", [
      org,
      input.IDENTITY_BOOTSTRAP_ORGANIZATION,
    ]);
    await c.query("INSERT INTO identity.members(organization_id,user_id,role) VALUES($1,$2,'ADMIN')", [
      org,
      user,
    ]);
    await c.query("COMMIT");
    console.log(`Bootstrap complete; organization ID: ${org}`);
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
} finally {
  await db.end();
}
