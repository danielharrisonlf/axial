import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";

const issuer = "http://localhost:3000/identity";
const audience = "axial-projects";

async function freePort() {
  const socket = createTcpServer();
  await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  return port;
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Streamable HTTP answers either a JSON body or an SSE stream; normalize both. */
async function jsonRpc(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const line = text
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("data:"))
      .at(-1);
    return line ? JSON.parse(line.slice(5).trim()) : null;
  }
  return parseBody(text);
}

const projectsPort = await freePort();
const mcpPort = await freePort();
const directory = await mkdtemp(join(tmpdir(), "axial-mcp-"));
const publicKeyPath = join(directory, "public.pem");
const seen = [];
let failure;
let stub;
let server;

const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
await writeFile(publicKeyPath, await exportSPKI(publicKey), "utf8");

async function sign(overrides = {}, tokenAudience = audience) {
  return new SignJWT({
    organizationId: "0190f0f0-0000-7000-8000-000000000001",
    role: "PROJECT_MANAGER",
    projectIds: ["0190f0f0-0000-7000-8000-000000000002"],
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setSubject("0190f0f0-0000-7000-8000-000000000003")
    .setIssuer(issuer)
    .setAudience(tokenAudience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

try {
  stub = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      seen.push({
        url: request.url,
        authorization: request.headers.authorization ?? null,
        body: parseBody(body),
      });
      if (request.url === "/api/v1/health/ready") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      // A valid empty page, so tools with an output schema succeed.
      response.end(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 25, request: request.url }));
    });
  });
  await new Promise((resolve) => stub.listen(projectsPort, "127.0.0.1", resolve));

  const env = {
    ...process.env,
    NODE_ENV: "test",
    MCP_PORT: String(mcpPort),
    MCP_RESOURCE: `http://127.0.0.1:${mcpPort}/mcp`,
    MCP_PUBLIC_KEY_PATH: publicKeyPath,
    MCP_JWT_ISSUER: issuer,
    MCP_JWT_AUDIENCE: audience,
    PROJECTS_API_URL: `http://127.0.0.1:${projectsPort}`,
    MCP_ALLOWED_ORIGINS: "http://localhost:5173",
  };
  server = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], { env, stdio: "inherit" });
  const closed = new Promise((resolve) => server.once("close", resolve));

  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${mcpPort}/health/live`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "MCP server failed to start");

    const readyResponse = await fetch(`http://127.0.0.1:${mcpPort}/health/ready`);
    assert.equal(readyResponse.status, 200);

    const token = await sign();
    const endpoint = `http://127.0.0.1:${mcpPort}/mcp`;
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    };

    const unauthenticated = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get("www-authenticate") ?? "", /resource_metadata/);

    const listed = await jsonRpc(
      await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      }),
    );
    const names = listed.result.tools.map((tool) => tool.name);
    for (const name of [
      "list-projects",
      "get-project",
      "list-tasks",
      "get-task",
      "create-task",
      "update-task-status",
    ])
      assert.ok(names.includes(name), `missing tool ${name}`);

    const called = await jsonRpc(
      await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "list-tasks",
            arguments: {
              projectId: "0190f0f0-0000-7000-8000-000000000002",
              status: "todo",
            },
          },
        }),
      }),
    );
    assert.ok(called.result && !called.result.isError, `tool call failed: ${JSON.stringify(called)}`);
    const forwarded = seen.find((entry) => entry.url?.includes("/tasks"));
    assert.equal(forwarded.authorization, `Bearer ${token}`);
    assert.match(forwarded.url, /status=todo/);

    const wrongAudience = await sign({}, "other-audience");
    const rejected = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, authorization: `Bearer ${wrongAudience}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
    });
    assert.equal(rejected.status, 401);

    const metadata = await fetch(`http://127.0.0.1:${mcpPort}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(metadata.status, 200);
    const resourceMetadata = await metadata.json();
    assert.equal(resourceMetadata.resource, env.MCP_RESOURCE);
    assert.deepEqual(resourceMetadata.authorization_servers, [issuer]);
    assert.deepEqual(resourceMetadata.scopes_supported, ["projects:read", "projects:write"]);
    assert.ok(
      (unauthenticated.headers.get("www-authenticate") ?? "").includes(
        `resource_metadata="http://127.0.0.1:${mcpPort}/.well-known/oauth-protected-resource/mcp"`,
      ),
    );

    // OAuth tokens (scope claim, MCP resource as audience) are limited to their scopes.
    const call = (bearer, id, name, args) =>
      fetch(endpoint, {
        method: "POST",
        headers: { ...headers, authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
      });
    const readOnly = await sign({ scope: "projects:read" }, [audience, env.MCP_RESOURCE]);
    const read = await jsonRpc(
      await call(readOnly, 5, "list-tasks", { projectId: "0190f0f0-0000-7000-8000-000000000002" }),
    );
    assert.ok(read.result && !read.result.isError, `read scope call failed: ${JSON.stringify(read)}`);
    const write = await call(readOnly, 6, "create-task", {
      projectId: "0190f0f0-0000-7000-8000-000000000002",
      title: "Needs write",
    });
    assert.equal(write.status, 403);
    assert.match(write.headers.get("www-authenticate") ?? "", /insufficient_scope/);
    const writer = await sign({ scope: "projects:read projects:write" }, [audience, env.MCP_RESOURCE]);
    const created = await jsonRpc(
      await call(writer, 7, "create-task", {
        projectId: "0190f0f0-0000-7000-8000-000000000002",
        title: "With write",
      }),
    );
    assert.ok(
      created.result && !created.result.isError,
      `write scope call failed: ${JSON.stringify(created)}`,
    );
    const catalog = await jsonRpc(
      await fetch(endpoint, {
        method: "POST",
        headers: { ...headers, authorization: `Bearer ${writer}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
      }),
    );
    assert.equal(
      catalog.result.tools.length,
      names.length,
      "an OAuth read+write token sees the full catalog",
    );
    const otherResource = await sign({ scope: "projects:read" }, audience);
    assert.equal(
      (await call(otherResource, 8, "list-tasks", { projectId: "0190f0f0-0000-7000-8000-000000000002" }))
        .status,
      401,
    );

    console.log(
      "Integration passed: MCP auth, tool listing, caller-token forwarding, resource metadata and OAuth scopes",
    );
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill();
    await closed;
  }
} catch (error) {
  failure = error;
} finally {
  if (stub) await new Promise((resolve) => stub.close(() => resolve()));
}
if (failure) throw failure;
