import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import type { IdentityTokenVerifier } from "../src/verifier.js";

const issuer = "http://localhost:3000/identity";
const audience = "axial-projects";
const organizationId = "0190f0f0-0000-7000-8000-000000000001";
const subject = "0190f0f0-0000-7000-8000-000000000003";
let privateKey: CryptoKey;
let verifier: IdentityTokenVerifier;

function sign(claims: Record<string, unknown> = {}, tokenAudience = audience) {
  return new SignJWT({ organizationId, role: "TEAM_LEAD", ...claims })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject(subject)
    .setIssuer(issuer)
    .setAudience(tokenAudience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const directory = await mkdtemp(join(tmpdir(), "axial-mcp-verifier-"));
  const path = join(directory, "public.pem");
  await writeFile(path, await exportSPKI(pair.publicKey), "utf8");
  Object.assign(process.env, {
    NODE_ENV: "test",
    MCP_PUBLIC_KEY_PATH: path,
    MCP_JWT_ISSUER: issuer,
    MCP_JWT_AUDIENCE: audience,
    MCP_RESOURCE: "http://localhost:3006/mcp",
  });
  const module = await import("../src/verifier.js");
  verifier = new module.IdentityTokenVerifier();
});

describe("identity token verifier", () => {
  it("accepts an Axial access token and derives scopes from the role", async () => {
    const token = await sign({ teamIds: [organizationId], source: "mcp" });
    const info = await verifier.verifyAccessToken(token);
    expect(info).toMatchObject({
      clientId: subject,
      scopes: ["projects:read", "notifications:read", "notifications:write", "projects:write", "audit:read"],
      resource: new URL("http://localhost:3006/mcp"),
    });
    expect((info?.extra as { identity?: unknown } | undefined)?.identity).toMatchObject({
      teamIds: [organizationId],
      source: "mcp",
      token,
    });
  });

  it("rejects other audiences, bad claims and single-purpose tokens", async () => {
    expect(await verifier.verifyAccessToken(await sign({}, "axial-projects-password-change"))).toBeNull();
    expect(await verifier.verifyAccessToken(await sign({ role: "OWNER" }))).toBeNull();
    expect(await verifier.verifyAccessToken(await sign({ purpose: "password_change" }))).toBeNull();
    expect(await verifier.verifyAccessToken("not-a-jwt")).toBeNull();
  });
});
