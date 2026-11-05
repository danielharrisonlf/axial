import "reflect-metadata";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const { createApp } = await import("./app.js");
const { readConfig } = await import("./common/config.js");
const app = await createApp();
await app.listen(readConfig().PORT, "0.0.0.0");
