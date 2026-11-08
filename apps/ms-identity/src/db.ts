import { Pool } from "pg";
export function pool(): Pool {
  const connectionString = process.env.IDENTITY_DATABASE_URL;
  if (!connectionString) throw new Error("IDENTITY_DATABASE_URL is required");
  return new Pool({ connectionString, max: 10 });
}
