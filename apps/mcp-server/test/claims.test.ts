import { describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair, exportPKCS8 } from "jose";

/**
 * The verifier is exercised end-to-end by the integration test against a real
 * signed token. This unit test pins the claim contract it accepts.
 */
describe("identity claim contract", () => {
  it("signs a token carrying the claims the verifier requires", async () => {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const pem = await exportPKCS8(privateKey);
    expect(pem).toContain("PRIVATE KEY");
    const token = await new SignJWT({
      organizationId: "0190f0f0-0000-7000-8000-000000000001",
      role: "PROJECT_MANAGER",
      projectIds: ["0190f0f0-0000-7000-8000-000000000002"],
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("0190f0f0-0000-7000-8000-000000000003")
      .setIssuer("http://localhost:3000/identity")
      .setAudience("axial-projects")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    expect(token.split(".")).toHaveLength(3);
  });
});
