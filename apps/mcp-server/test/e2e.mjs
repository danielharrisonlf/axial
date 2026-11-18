/**
 * End to end against the real ms-projects: PostgreSQL `_test` database, Redis, the real API process and the
 * real MCP HTTP process, talking through a real MCP client. Every run uses fresh random organizations, so it
 * never resets or touches other data.
 *
 * Needs: `pnpm infra:up`, `pnpm db:generate`, migrations applied to the test database, and
 * TEST_DATABASE_URL / TEST_REDIS_URL (the database name must end in `_test`).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, InsufficientScopeError, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error("TEST_DATABASE_URL and TEST_REDIS_URL are required");
if (!new URL(databaseUrl).pathname.replace(/^\//, "").endsWith("_test"))
  throw new Error("Refusing to run: the database name must end in _test");

const mcpDirectory = fileURLToPath(new URL("..", import.meta.url));
const apiDirectory = fileURLToPath(new URL("../../api/", import.meta.url));
if (!existsSync(join(apiDirectory, "src/generated/prisma")))
  throw new Error("Prisma client missing: run pnpm db:generate first");

const issuer = "http://localhost:3000/identity";
const audience = "axial-projects";
const children = [];
const clients = [];

async function freePort() {
  const socket = createTcpServer();
  await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

function start(name, cwd, entry, env) {
  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  child.closed = new Promise((resolve) => child.once("close", resolve));
  child.describe = () => `${name} exited (${child.exitCode}): ${stderr}`;
  children.push(child);
  return child;
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error(child.describe());
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const text = (result) => result.content?.find((block) => block.type === "text")?.text ?? "";
const json = (result) => JSON.parse(text(result));

const directory = await mkdtemp(join(tmpdir(), "axial-mcp-e2e-"));
let failure;
try {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const publicKeyPath = join(directory, "public.pem");
  await writeFile(publicKeyPath, await exportSPKI(publicKey), "utf8");
  const [apiPort, mcpPort] = [await freePort(), await freePort()];

  const api = start("ms-projects", apiDirectory, "src/main.ts", {
    NODE_ENV: "test",
    PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    JWT_ISSUER: issuer,
    JWT_AUDIENCE: audience,
    JWT_PUBLIC_KEY_PATH: publicKeyPath,
    RELAY_ENABLED: "false",
  });
  await waitFor(`http://127.0.0.1:${apiPort}/api/v1/health/ready`, api);

  const resource = `http://127.0.0.1:${mcpPort}/mcp`;
  const mcp = start("mcp-server", mcpDirectory, "src/main.ts", {
    NODE_ENV: "test",
    MCP_PORT: String(mcpPort),
    MCP_RESOURCE: resource,
    MCP_PUBLIC_KEY_PATH: publicKeyPath,
    MCP_JWT_ISSUER: issuer,
    MCP_JWT_AUDIENCE: audience,
    PROJECTS_API_URL: `http://127.0.0.1:${apiPort}`,
  });
  await waitFor(`http://127.0.0.1:${mcpPort}/health/ready`, mcp);

  const organizationId = randomUUID();
  const userId = randomUUID();
  const sign = (claims = {}) =>
    new SignJWT({
      organizationId,
      role: "ADMIN",
      teamIds: [],
      projectIds: [],
      assignableUserIds: [userId],
      assignableTeamIds: [],
      source: "mcp",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  async function connect(token, era = "modern") {
    const client = new Client(
      { name: "axial-mcp-e2e", version: "1.0.0" },
      era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {},
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    return client;
  }
  const call = async (client, name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `${name} failed: ${text(result)}`);
    return result.structuredContent ?? json(result);
  };

  const admin = await connect(await sign());
  const key = `E${randomUUID()
    .replace(/-/g, "")
    .slice(0, 7)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "X")}`;
  const project = await call(admin, "create-project", { key, name: "MCP end to end", priority: "high" });
  assert.equal(project.key, key);

  const first = await call(admin, "create-task", {
    projectId: project.id,
    title: "Wire checkout",
    status: "todo",
    priority: "urgent",
    estimate: 5,
  });
  assert.equal(first.ref, `${key}-1`);
  const second = await call(admin, "create-task", {
    projectId: project.id,
    title: "Release checkout",
    blockedByIds: [first.id],
  });

  const moved = await call(admin, "update-task-status", {
    taskId: first.id,
    status: "in_progress",
    version: first.version,
  });
  assert.equal(moved.version, first.version + 1);

  const stale = await admin.callTool({
    name: "update-task-status",
    arguments: { taskId: first.id, status: "in_review", version: first.version },
  });
  assert.equal(stale.isError, true);
  assert.match(text(stale), /^Conflict \[409\]: .*Read the resource again/);

  const assigned = await call(admin, "assign-task", {
    taskId: first.id,
    version: moved.version,
    assigneeId: userId,
  });
  assert.equal(assigned.assigneeId, userId);

  const sprint = await call(admin, "create-sprint", {
    projectId: project.id,
    name: "Sprint E2E",
    startDate: "2026-11-16T00:00:00Z",
    endDate: "2026-11-30T00:00:00Z",
  });
  const progress = [];
  const planned = await admin.callTool(
    { name: "assign-tasks-to-sprint", arguments: { sprintId: sprint.id, taskIds: [first.id, second.id] } },
    { onprogress: (update) => progress.push(update.progress) },
  );
  assert.deepEqual(json(planned).succeeded, 2);
  assert.deepEqual(progress, [1, 2]);

  const listed = await call(admin, "list-tasks", { projectId: project.id, sprintId: sprint.id });
  assert.equal(listed.total, 2);

  await call(admin, "add-comment", { taskId: first.id, body: "Started through MCP" });
  assert.equal((await call(admin, "list-comments", { taskId: first.id })).total, 1);

  const board = await admin.readResource({ uri: `axial://projects/${project.id}/board` });
  assert.match(board.contents[0].text, new RegExp(`${key}-2 · Release checkout .*bloqueada por ${key}-1`));

  const risk = await admin.getPrompt({ name: "relatorio-de-risco", arguments: { projectId: project.id } });
  assert.match(
    risk.messages[0].content.text,
    new RegExp(`Bloqueadas por dependências abertas \\(1\\):\\n- ${key}-2`),
  );

  const legacy = await connect(await sign(), "legacy");
  const current = await call(legacy, "get-task", { taskId: second.id });
  const refused = await legacy.callTool({
    name: "delete-task",
    arguments: { taskId: second.id, version: current.version },
  });
  assert.match(text(refused), /Confirmation required/);
  assert.equal((await call(legacy, "get-task", { taskId: second.id })).id, second.id);
  const deleted = await call(legacy, "delete-task", {
    taskId: second.id,
    version: current.version,
    confirm: true,
  });
  assert.deepEqual(deleted, { id: second.id, deleted: true });

  const outsider = await connect(await sign({ organizationId: randomUUID() }));
  const hidden = await outsider.callTool({ name: "get-project", arguments: { projectId: project.id } });
  assert.equal(hidden.isError, true);
  assert.match(text(hidden), /^Not found \[404\]/);

  const viewer = await connect(await sign({ role: "VIEWER", projectIds: [project.id] }));
  const visible = await call(viewer, "get-project", { projectId: project.id });
  assert.equal(visible.id, project.id);
  await assert.rejects(
    viewer.callTool({ name: "create-task", arguments: { projectId: project.id, title: "Nope" } }),
    InsufficientScopeError,
  );

  const contributor = await connect(await sign({ role: "CONTRIBUTOR", projectIds: [project.id] }));
  const forbidden = await contributor.callTool({
    name: "update-project",
    arguments: { projectId: project.id, version: project.version, name: "Renamed" },
  });
  assert.equal(forbidden.isError, true);
  assert.match(text(forbidden), /^Forbidden \[403\]/);

  console.log(
    "E2E passed: real ms-projects + MCP over HTTP (create, move, 409, assign, sprint batch, comment, board, prompt, confirmed delete, org isolation, scopes, upstream 403)",
  );
} catch (error) {
  failure = error;
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
  await Promise.all(children.map((child) => child.closed));
  await rm(directory, { recursive: true, force: true });
}
if (failure) throw failure;
