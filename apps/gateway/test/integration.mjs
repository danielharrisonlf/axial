import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

async function freePort() {
  const socket = createTcpServer();
  await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return port;
}

const stubPorts = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort(), freePort()]);
const [projectsPort, identityPort, notificationsPort, realtimePort, auditPort, mcpPort] = stubPorts;
const gatewayPort = await freePort();
const stubs = new Map();
let failure;
const cleanupErrors = [];

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(() => resolve()));
}

try {
  const definitions = [
    ["projects", projectsPort],
    ["identity", identityPort],
    ["notifications", notificationsPort],
    ["realtime", realtimePort],
    ["audit", auditPort],
    ["mcp", mcpPort],
  ];
  for (const [name, port] of definitions) {
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            service: name,
            method: request.method,
            url: request.url,
            authorization: request.headers.authorization ?? null,
            body: body ? JSON.parse(body) : null,
          }),
        );
      });
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
    stubs.set(name, server);
  }

  const realtime = stubs.get("realtime");
  const wss = new WebSocketServer({ server: realtime, path: "/ws" });
  wss.on("connection", (socket) => socket.on("message", (message) => socket.send(message)));

  const env = {
    ...process.env,
    NODE_ENV: "test",
    GATEWAY_PORT: String(gatewayPort),
    PROJECTS_API_URL: `http://127.0.0.1:${projectsPort}`,
    IDENTITY_API_URL: `http://127.0.0.1:${identityPort}`,
    NOTIFICATIONS_API_URL: `http://127.0.0.1:${notificationsPort}`,
    REALTIME_API_URL: `http://127.0.0.1:${realtimePort}`,
    AUDIT_API_URL: `http://127.0.0.1:${auditPort}`,
    MCP_API_URL: `http://127.0.0.1:${mcpPort}`,
    GATEWAY_CORS_ORIGINS: "http://localhost:5173",
  };
  const gateway = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], { env, stdio: "inherit" });
  const closed = new Promise((resolve) => gateway.once("close", resolve));
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/health/live`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "gateway failed to start");

    const routed = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/projects/abc/tasks?page=2`, {
      headers: { authorization: "Bearer caller-token" },
    });
    const routedBody = await routed.json();
    assert.equal(routedBody.service, "projects");
    assert.equal(routedBody.url, "/api/v1/projects/abc/tasks?page=2");
    assert.equal(routedBody.authorization, "Bearer caller-token");

    assert.equal(
      (await (await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/auth/login`, { method: "POST" })).json())
        .service,
      "identity",
    );
    assert.equal(
      (await (await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/notification-preferences`)).json()).service,
      "notifications",
    );
    assert.equal(
      (await (await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/audit/summary`)).json()).service,
      "audit",
    );

    const mcp = await fetch(`http://127.0.0.1:${gatewayPort}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.deepEqual((await mcp.json()).body, { jsonrpc: "2.0", id: 1, method: "tools/list" });

    const health = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/health/ready`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).services.length, 6);

    const cors = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/tasks`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    assert.equal(cors.status, 204);
    assert.equal(cors.headers.get("access-control-allow-origin"), "http://localhost:5173");

    const socket = new WebSocket(`ws://127.0.0.1:${gatewayPort}/ws`);
    await new Promise((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const echoed = new Promise((resolve) => socket.once("message", (data) => resolve(String(data))));
    socket.send("invalidation");
    assert.equal(await echoed, "invalidation");
    socket.close();

    await closeServer(stubs.get("notifications"));
    stubs.delete("notifications");
    const degraded = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/health/ready`);
    assert.equal(degraded.status, 503);
    const unavailable = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/notification-preferences`);
    assert.equal(unavailable.status, 502);
    console.log("Integration passed: REST/WSS/MCP proxying, header forwarding, CORS and health aggregation");
  } finally {
    if (gateway.exitCode === null && gateway.signalCode === null) gateway.kill();
    await closed;
  }
} catch (error) {
  failure = error;
} finally {
  for (const [name, server] of stubs) {
    try {
      await closeServer(server);
    } catch (error) {
      cleanupErrors.push(new Error(`Failed to close ${name}: ${String(error)}`));
    }
  }
}
const errors = [...(failure ? [failure] : []), ...cleanupErrors];
if (errors.length) throw new AggregateError(errors, "Gateway integration test or cleanup failed");
