import { Pool } from "pg";

export function pool(): Pool {
  const connectionString = process.env.IDENTITY_DATABASE_URL;
  if (!connectionString) throw new Error("IDENTITY_DATABASE_URL is required");
  // BetterAuth emits unqualified table names; the search path pins them to the
  // identity schema while application queries stay fully qualified.
  return new Pool({
    connectionString,
    max: 10,
    options: "-c search_path=identity,public",
  });
}
