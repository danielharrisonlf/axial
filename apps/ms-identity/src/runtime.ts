import "./env.js";
import type { PoolClient } from "pg";
import { createAuth } from "./auth.js";
import { pool } from "./db.js";
import { readSettings } from "./settings.js";
import { loadKeys } from "./tokens.js";

/** Process-wide resources shared by the controllers of the service. */
export const settings = readSettings();
export const db = pool();
export const auth = createAuth(db);
export const { privateKey, publicKey } = await loadKeys();

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
