/**
 * The real OAuth path of a remote MCP client, as processes: ms-identity (authorization server, disposable
 * `*_test` database), ms-projects (TEST_DATABASE_URL), the mcp-server and the gateway in front of them, with
 * ephemeral keys. Everything an MCP client sees goes through the gateway, as in production.
 *
 * Needs IDENTITY_TEST_DATABASE_URL (a `*_test` database whose user has CREATEDB), TEST_DATABASE_URL (a `*_test`
 * database with the ms-projects migrations), TEST_REDIS_URL and the generated Prisma client.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ADMIN_EMAIL = "admin@example.test";
export const ADMIN_PASSWORD = "a-secure-test-password";
export const MEMBER_EMAIL = "member@example.test";
export const MEMBER_PASSWORD = "member-private-password";

const appsDirectory = fileURLToPath(new URL("../../../", import.meta.url));
const directoryOf = (app) => join(appsDirectory, app);
// The disposable identity database is created with the PostgreSQL driver ms-identity already depends on.
const pg = createRequire(join(directoryOf("ms-identity"), "package.json"))("pg");

function testDatabase(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  if (!new URL(value).pathname.replace(/^\//, "").endsWith("_test"))
    throw new Error(`Refusing to run: ${name} must name a database ending in _test`);
  return value;
}

async function freePort() {
  const socket = createTcpServer();
  await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

export async function startOAuthStack() {
  const identityAdminUrl = testDatabase("IDENTITY_TEST_DATABASE_URL");
  const projectsUrl = testDatabase("TEST_DATABASE_URL");
  const redisUrl = process.env.TEST_REDIS_URL;
  if (!redisUrl) throw new Error("TEST_REDIS_URL is required");
  if (!existsSync(join(directoryOf("api"), "src/generated/prisma")))
    throw new Error("Prisma client missing: run pnpm db:generate first");

  const [gatewayPort, identityPort, mcpPort, projectsPort] = await Promise.all(
    Array.from({ length: 4 }, freePort),
  );
  const gateway = `http://127.0.0.1:${gatewayPort}`;
  const issuer = `${gateway}/identity`;
  const resource = `${gateway}/mcp`;
  const directory = mkdtempSync(join(tmpdir(), "axial-mcp-oauth-"));
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const publicKeyPath = join(directory, "public.pem");
  writeFileSync(join(directory, "private.pem"), keys.privateKey);
  writeFileSync(publicKeyPath, keys.publicKey);

  const admin = new pg.Pool({ connectionString: identityAdminUrl });
  const databaseName = `axial_mcp_oauth_${randomUUID().replaceAll("-", "")}_test`;
  const identityUrl = new URL(identityAdminUrl);
  identityUrl.pathname = `/${databaseName}`;
  const children = [];
  let db;
  let created = false;

  const close = async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.all(children.map((child) => child.closed));
    await db?.end();
    if (created) await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
    rmSync(directory, { recursive: true, force: true });
  };

  const start = (name, cwd, env) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd,
      env: { ...process.env, NODE_ENV: "test", ...env },
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
  };
  const waitFor = async (url, child) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (child.exitCode !== null) throw new Error(child.describe());
      try {
        if ((await fetch(url)).ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out waiting for ${url}`);
  };

  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    db = new pg.Pool({ connectionString: identityUrl.toString() });
    const identityEnv = {
      ...process.env,
      NODE_ENV: "test",
      IDENTITY_DATABASE_URL: identityUrl.toString(),
      IDENTITY_PRIVATE_KEY_PATH: join(directory, "private.pem"),
      IDENTITY_PUBLIC_KEY_PATH: publicKeyPath,
      IDENTITY_ISSUER: issuer,
      IDENTITY_AUDIENCE: "axial-projects",
      IDENTITY_OAUTH_RESOURCE: resource,
      BETTER_AUTH_SECRET: "oauth-e2e-secret-with-at-least-32-chars",
      BETTER_AUTH_URL: gateway,
      IDENTITY_PORT: String(identityPort),
      // The gateway is the only proxy in front of the service.
      IDENTITY_TRUST_PROXY: "1",
      IDENTITY_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      IDENTITY_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD,
      IDENTITY_BOOTSTRAP_ORGANIZATION: "Alpha organization",
    };
    for (const file of ["src/migrate.ts", "src/bootstrap.ts"]) {
      const run = spawnSync(process.execPath, ["--import", "tsx", file], {
        cwd: directoryOf("ms-identity"),
        env: identityEnv,
        encoding: "utf8",
      });
      if (run.status !== 0) throw new Error(run.stderr || run.stdout);
    }

    const identity = start("ms-identity", directoryOf("ms-identity"), identityEnv);
    const projects = start("ms-projects", directoryOf("api"), {
      PORT: String(projectsPort),
      DATABASE_URL: projectsUrl,
      REDIS_URL: redisUrl,
      JWT_ISSUER: issuer,
      JWT_AUDIENCE: "axial-projects",
      JWT_PUBLIC_KEY_PATH: publicKeyPath,
      RELAY_ENABLED: "false",
    });
    const mcp = start("mcp-server", directoryOf("mcp-server"), {
      MCP_PORT: String(mcpPort),
      MCP_RESOURCE: resource,
      MCP_PUBLIC_KEY_PATH: publicKeyPath,
      MCP_JWT_ISSUER: issuer,
      MCP_JWT_AUDIENCE: "axial-projects",
      PROJECTS_API_URL: `http://127.0.0.1:${projectsPort}`,
      IDENTITY_API_URL: `http://127.0.0.1:${identityPort}`,
      MCP_ALLOWED_HOSTS: "127.0.0.1,localhost",
    });
    const edge = start("gateway", directoryOf("gateway"), {
      GATEWAY_PORT: String(gatewayPort),
      PROJECTS_API_URL: `http://127.0.0.1:${projectsPort}`,
      IDENTITY_API_URL: `http://127.0.0.1:${identityPort}`,
      MCP_API_URL: `http://127.0.0.1:${mcpPort}`,
    });
    await waitFor(`http://127.0.0.1:${identityPort}/api/v1/health/ready`, identity);
    await waitFor(`http://127.0.0.1:${projectsPort}/api/v1/health/ready`, projects);
    await waitFor(`http://127.0.0.1:${mcpPort}/health/ready`, mcp);
    await waitFor(`${gateway}/api/v1/health/live`, edge);

    // Accounts through the gateway: the administrator belongs to two organizations, the member to one.
    const api = async (path, body, token, method = "POST") => {
      const response = await fetch(`${gateway}/api/v1/${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    const alpha = (await db.query("SELECT id FROM identity.organizations LIMIT 1")).rows[0].id;
    const login = await api("auth/login", {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      organizationId: alpha,
    });
    assert.equal(login.status, 201, JSON.stringify(login.body));
    const beta = await api("organizations", { name: "Beta organization" }, login.body.accessToken);
    assert.equal(beta.status, 201, JSON.stringify(beta.body));
    const member = await api(
      "members",
      { email: MEMBER_EMAIL, password: "member-temporary-password", role: "CONTRIBUTOR" },
      login.body.accessToken,
    );
    assert.equal(member.status, 201, JSON.stringify(member.body));
    const temporary = await api("auth/login", {
      email: MEMBER_EMAIL,
      password: "member-temporary-password",
      organizationId: alpha,
    });
    const changed = await api(
      "auth/password",
      { currentPassword: "member-temporary-password", newPassword: MEMBER_PASSWORD },
      temporary.body.accessToken,
    );
    assert.equal(changed.status, 201, JSON.stringify(changed.body));

    return { gateway, issuer, resource, db, alpha, beta: beta.body.id, memberId: member.body.id, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Hidden inputs of a consent page, unescaped. */
export function hiddenFields(html) {
  const fields = {};
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g))
    fields[match[1]] = match[2]
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
  return fields;
}

/** The claims of a JWT, without verification (the services verify; tests only read). */
export function claimsOf(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}
