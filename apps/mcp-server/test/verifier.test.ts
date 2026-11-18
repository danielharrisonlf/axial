import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import type { IdentityTokenVerifier, VerifiedIdentity } from "../src/verifier.js";

const issuer = "http://localhost:3000/identity";
const audience = "axial-projects";
const resource = "http://localhost:3006/mcp";
const organizationId = "0190f0f0-0000-7000-8000-000000000001";
const subject = "0190f0f0-0000-7000-8000-000000000003";
let privateKey: CryptoKey;
let verifier: IdentityTokenVerifier;

function sign(claims: Record<string, unknown> = {}, tokenAudience: string | string[] = audience) {
  return new SignJWT({ organizationId, role: "TEAM_LEAD", ...claims })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject(subject)
    .setIssuer(issuer)
    .setAudience(tokenAudience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

const identityOf = (extra: unknown) => (extra as { identity?: VerifiedIdentity } | undefined)?.identity;

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
    MCP_RESOURCE: resource,
  });
  const module = await import("../src/verifier.js");
  verifier = new module.IdentityTokenVerifier();
});

describe("identity token verifier", () => {
  it("gives a first-party token (no scope claim) full access and keeps its identity claims", async () => {
    const token = await sign({ teamIds: [organizationId], source: "ui" });
    const info = await verifier.verifyAccessToken(token);
    expect(info).toMatchObject({
      clientId: subject,
      scopes: ["projects:read", "projects:write"],
      resource: new URL(resource),
    });
    expect(identityOf(info?.extra)).toMatchObject({
      teamIds: [organizationId],
      source: "ui",
      clientId: subject,
      token,
    });
  });

  it("limits an OAuth token for this resource to its granted scopes", async () => {
    const token = await sign({ scope: "projects:read", client_id: "claude", source: "mcp" }, [
      audience,
      resource,
    ]);
    const info = await verifier.verifyAccessToken(token);
    expect(info).toMatchObject({ clientId: "claude", scopes: ["projects:read"] });
    expect(identityOf(info?.extra)).toMatchObject({ source: "mcp", clientId: "claude" });
  });

  it("rejects OAuth tokens for another resource, other audiences, bad claims and single-purpose tokens", async () => {
    expect(await verifier.verifyAccessToken(await sign({ scope: "projects:read" }))).toBeNull();
    expect(await verifier.verifyAccessToken(await sign({}, "axial-projects-password-change"))).toBeNull();
    expect(await verifier.verifyAccessToken(await sign({ role: "OWNER" }))).toBeNull();
    expect(await verifier.verifyAccessToken(await sign({ purpose: "password_change" }))).toBeNull();
    expect(await verifier.verifyAccessToken("not-a-jwt")).toBeNull();
  });
});
