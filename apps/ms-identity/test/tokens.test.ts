import { type CryptoKey, exportSPKI, generateKeyPair, importSPKI } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

process.env.IDENTITY_ISSUER = process.env.IDENTITY_ISSUER ?? "http://localhost:3000/identity";
process.env.IDENTITY_AUDIENCE = process.env.IDENTITY_AUDIENCE ?? "axial-projects";

type Tokens = typeof import("../src/tokens.js");
let tokens: Tokens;
let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicKey = await importSPKI(await exportSPKI(pair.publicKey), "RS256");
  tokens = await import("../src/tokens.js");
});

const claims = {
  userId: "0190f0f0-0000-7000-8000-000000000003",
  organizationId: "0190f0f0-0000-7000-8000-000000000001",
  role: "PROJECT_MANAGER" as const,
  teamIds: [],
  projectIds: ["0190f0f0-0000-7000-8000-000000000002"],
  assignableUserIds: [],
  assignableTeamIds: [],
  source: "api" as const,
};

describe("identity access tokens", () => {
  it("round-trips organization, role, teams and project scope", async () => {
    const token = await tokens.signAccessToken(privateKey, claims);
    const verified = await tokens.verifyAccessToken(publicKey, token);
    expect(verified).toMatchObject({
      sub: claims.userId,
      organizationId: claims.organizationId,
      role: "PROJECT_MANAGER",
      projectIds: claims.projectIds,
      source: "api",
    });
  });

  it("keeps password-change tokens on a separate audience", async () => {
    const token = await tokens.signPasswordChangeToken(privateKey, claims.userId, claims.organizationId);
    await expect(tokens.verifyAccessToken(publicKey, token)).rejects.toThrow();
    const verified = await tokens.verifyAccessToken(publicKey, token, { passwordChange: true });
    expect(verified.sub).toBe(claims.userId);
    expect(tokens.isPasswordChangeToken({ purpose: "password_change" })).toBe(true);
  });
});
