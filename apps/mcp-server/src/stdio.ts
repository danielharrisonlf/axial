import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

/*
 * stdio transport, for hosts that launch the server as a local process. There is no bypass: the caller is
 * the user of a signed access token from MCP_ACCESS_TOKEN_FILE (re-read on every call, so it can be
 * refreshed) or MCP_ACCESS_TOKEN, verified like an HTTP bearer token on every call, scopes included.
 * stdout carries the protocol; every log goes to stderr.
 */
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const { NestFactory } = await import("@nestjs/core");
const { McpStdioLogger, McpStdioServer } = await import("@nestjs/mcp");
const { AppModule } = await import("./app.js");
const { CallerIdentity } = await import("./identity.js");

const app = await NestFactory.createApplicationContext(AppModule, { logger: new McpStdioLogger() });
app.enableShutdownHooks();
try {
  const identity = await app.get(CallerIdentity).stdio();
  process.stderr.write(
    `Axial MCP over stdio as user ${identity.userId} (${identity.role}) of organization ${identity.organizationId}; token expires ${new Date(identity.expiresAt * 1000).toISOString()}\n`,
  );
} catch (error) {
  process.stderr.write(
    `Axial MCP stdio refused to start: ${error instanceof Error ? error.message : "invalid token"}\n`,
  );
  await app.close();
  process.exit(1);
}
await app.get(McpStdioServer).listen();
await app.close();
