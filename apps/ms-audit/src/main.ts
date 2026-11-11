import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const { createApp, shutdown } = await import("./app.js");
const app = await createApp();
const port = Number(process.env.AUDIT_PORT ?? "3005");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid AUDIT_PORT");
await app.listen(port, "0.0.0.0");

for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void shutdown(app)
      .catch((error) => console.error("Audit shutdown error", error))
      .finally(() => process.exit());
  });
