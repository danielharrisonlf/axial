import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const { createGateway } = await import("./app.js");
const { app, realtime } = await createGateway();
const port = Number(process.env.GATEWAY_PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid GATEWAY_PORT");
await app.listen(port, "0.0.0.0");

const server = app.getHttpServer();
server.on(
  "upgrade",
  (request: import("node:http").IncomingMessage, socket: import("node:net").Socket, head: Buffer) => {
    if (request.url === "/ws") realtime.upgrade(request, socket, head);
    else socket.destroy();
  },
);

for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close().finally(() => process.exit());
  });
