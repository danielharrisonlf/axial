import { Pool } from "pg";

const url = process.env.NOTIFICATIONS_DATABASE_URL;
if (!url) throw new Error("NOTIFICATIONS_DATABASE_URL is required");
export const db = new Pool({ connectionString: url, max: 10 });
