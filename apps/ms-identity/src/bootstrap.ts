import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { createAuth } from "./auth.js";
import { pool } from "./db.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const input = z
  .object({
    IDENTITY_BOOTSTRAP_EMAIL: z.email().max(254),
    IDENTITY_BOOTSTRAP_PASSWORD: z.string().min(14).max(128),
    IDENTITY_BOOTSTRAP_ORGANIZATION: z.string().trim().min(1).max(120),
  })
  .parse(process.env);
const db = pool();
const auth = createAuth(db);
try {
  const existing = await db.query("SELECT 1 FROM identity.organizations LIMIT 1");
  if (existing.rowCount) throw new Error("Bootstrap denied: identity already contains an organization");
  const created = await auth.api.signUpEmail({
    body: {
      email: input.IDENTITY_BOOTSTRAP_EMAIL.toLowerCase(),
      password: input.IDENTITY_BOOTSTRAP_PASSWORD,
      name: input.IDENTITY_BOOTSTRAP_EMAIL.split("@")[0] ?? input.IDENTITY_BOOTSTRAP_EMAIL,
    },
  });
  const organizationId = randomUUID();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('axial-identity-bootstrap'))");
    const raced = await client.query("SELECT 1 FROM identity.organizations LIMIT 1");
    if (raced.rowCount) throw new Error("Bootstrap denied: identity already contains an organization");
    await client.query("INSERT INTO identity.organizations(id,name) VALUES($1,$2)", [
      organizationId,
      input.IDENTITY_BOOTSTRAP_ORGANIZATION,
    ]);
    await client.query("INSERT INTO identity.members(organization_id,user_id,role) VALUES($1,$2,'ADMIN')", [
      organizationId,
      created.user.id,
    ]);
    await client.query(`UPDATE identity."user" SET "mustChangePassword"=false WHERE id=$1`, [
      created.user.id,
    ]);
    await client.query("COMMIT");
    console.log(`Bootstrap complete; organization ID: ${organizationId}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await db.end();
}
