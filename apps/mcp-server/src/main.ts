import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const { createApp } = await import("./app.js");
const { readConfig } = await import("./config.js");

const app = await createApp();
const { MCP_PORT } = readConfig();
await app.listen(MCP_PORT, "0.0.0.0");

for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app
      .close()
      .catch((error) => console.error("MCP shutdown error", error))
      .finally(() => process.exit());
  });
