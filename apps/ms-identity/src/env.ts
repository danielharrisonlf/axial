import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

// Imported first by the entry points, so every module reads the same environment.
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
