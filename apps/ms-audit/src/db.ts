import { Pool } from "pg";

const url = process.env.AUDIT_DATABASE_URL;
if (!url) throw new Error("AUDIT_DATABASE_URL is required");
export const db = new Pool({ connectionString: url, max: 10 });
