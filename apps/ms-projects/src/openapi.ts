import "reflect-metadata";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
process.env.RELAY_ENABLED = "false";
const { createApp, createOpenApi } = await import("./app.js");
const app = await createApp();
try {
  const directory = fileURLToPath(new URL("../../../docs/api/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/openapi.json`, `${JSON.stringify(createOpenApi(app), null, 2)}\n`);
} finally {
  await app.close();
}
