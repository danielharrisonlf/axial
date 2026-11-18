import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUDIENCE,
  ISSUER,
  ORG,
  PROJECT,
  page,
  projectFixture,
  text,
  UpstreamStub,
  USER,
} from "./support/harness.js";

/*
 * The real stdio entry point in a child process: the identity comes from a signed token in a file that is
 * re-read and re-verified on every call, and scopes are enforced as over HTTP.
 */
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
let directory: string;
let tokenFile: string;
let privateKey: CryptoKey;
let foreignKey: CryptoKey;
let env: Record<string, string>;
const stub = new UpstreamStub();
let client: Client | undefined;

function sign(key: CryptoKey, role = "PROJECT_MANAGER") {
  return new SignJWT({ organizationId: ORG, role, projectIds: [PROJECT] })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setSubject(USER)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "axial-mcp-stdio-"));
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  foreignKey = (await generateKeyPair("RS256", { extractable: true })).privateKey;
  const publicKeyPath = join(directory, "public.pem");
  await writeFile(publicKeyPath, await exportSPKI(pair.publicKey), "utf8");
  tokenFile = join(directory, "token");
  await stub.start();
  const base = `http://127.0.0.1:${stub.port}`;
  env = {
    ...(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) as Record<
      string,
      string
    >),
    NODE_ENV: "test",
    MCP_PUBLIC_KEY_PATH: publicKeyPath,
    MCP_JWT_ISSUER: ISSUER,
    MCP_JWT_AUDIENCE: AUDIENCE,
    MCP_RESOURCE: "http://localhost:3006/mcp",
    PROJECTS_API_URL: `${base}/projects`,
    AUDIT_API_URL: `${base}/audit`,
    NOTIFICATIONS_API_URL: `${base}/notifications`,
    IDENTITY_API_URL: `${base}/identity`,
    MCP_ACCESS_TOKEN_FILE: tokenFile,
  };
});

afterAll(async () => {
  await client?.close();
  await stub.stop();
  await rm(directory, { recursive: true, force: true });
});

describe("stdio transport", () => {
  it("refuses to start without a valid token", async () => {
    await writeFile(tokenFile, await sign(foreignKey), "utf8");
    const child = spawn(process.execPath, ["--import", "tsx", "src/stdio.ts"], {
      cwd: appDirectory,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
    expect(code).toBe(1);
    expect(stderr).toContain(
      "Axial MCP stdio refused to start: The stdio access token is invalid or expired",
    );
  });

  it("acts as the token's user, re-reads the token on each call and enforces scopes", async () => {
    const managerToken = await sign(privateKey);
    await writeFile(tokenFile, managerToken, "utf8");
    stub.on("GET", "projects", "/projects", { body: page([projectFixture()]) });
    client = new Client({ name: "axial-stdio-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "src/stdio.ts"],
        cwd: appDirectory,
        env,
        stderr: "pipe",
      }),
    );

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(40);
    const listed = await client.callTool({ name: "list-projects", arguments: {} });
    expect(listed.isError).toBeFalsy();
    expect(stub.requests("GET", "projects", "/projects")[0]?.authorization).toBe(`Bearer ${managerToken}`);
    const me = await client.readResource({ uri: "axial://me" });
    expect(JSON.parse((me.contents[0] as { text: string }).text)).toMatchObject({
      userId: USER,
      role: "PROJECT_MANAGER",
      transport: "stdio",
    });

    await writeFile(tokenFile, await sign(privateKey, "VIEWER"), "utf8");
    const denied = await client.callTool({
      name: "create-task",
      arguments: { projectId: PROJECT, title: "x" },
    });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toBe(
      "Forbidden [403]: Insufficient scope: the access token lacks projects:write. Issue a token that grants it",
    );
    expect(stub.requests("POST", "projects")).toHaveLength(0);

    await writeFile(tokenFile, await sign(foreignKey), "utf8");
    const rejected = await client.callTool({ name: "list-projects", arguments: {} });
    expect(rejected.isError).toBe(true);
    expect(text(rejected)).toMatch(/^Unauthenticated \[401\]: The stdio access token is invalid or expired/);
  });
});
