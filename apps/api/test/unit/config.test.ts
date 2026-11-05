import { describe, expect, it } from "vitest";
import { readConfig } from "../../src/common/config.js";

const environment = {
  DATABASE_URL: "postgresql://user:private-password@localhost/axial_test",
  REDIS_URL: "redis://localhost:6389",
  JWT_ISSUER: "https://identity.test",
  JWT_AUDIENCE: "axial",
  JWT_PUBLIC_KEY_PATH: "test-public.pem",
};

describe("startup configuration", () => {
  it("parses relay switches and bounds polling instead of treating false as truthy", () => {
    expect(readConfig(environment)).toMatchObject({ RELAY_ENABLED: false, PORT: 3001 });
    expect(readConfig({ ...environment, RELAY_ENABLED: "true", RELAY_POLL_MS: "50" })).toMatchObject({
      RELAY_ENABLED: true,
      RELAY_POLL_MS: 50,
    });
    for (const value of ["yes", "1", ""])
      expect(() => readConfig({ ...environment, RELAY_ENABLED: value })).toThrow();
    for (const value of ["0", "49", "60001"])
      expect(() => readConfig({ ...environment, RELAY_POLL_MS: value })).toThrow();
  });

  it("requires authentication configuration and HTTPS for remote JWKS", () => {
    expect(() => readConfig({ ...environment, JWT_PUBLIC_KEY_PATH: undefined })).toThrow(
      "JWT_PUBLIC_KEY_PATH",
    );
    expect(() =>
      readConfig({
        ...environment,
        JWT_PUBLIC_KEY_PATH: undefined,
        JWT_JWKS_URL: "http://identity.test/keys",
      }),
    ).toThrow("JWT_JWKS_URL");
    expect(
      readConfig({
        ...environment,
        JWT_PUBLIC_KEY_PATH: undefined,
        JWT_JWKS_URL: "https://identity.test/keys",
      }).JWT_JWKS_URL,
    ).toBe("https://identity.test/keys");
  });

  it("rejects invalid connection protocols without leaking connection secrets", () => {
    expect(() =>
      readConfig({ ...environment, DATABASE_URL: "https://private-password@example.test/db" }),
    ).toThrow("DATABASE_URL");
    expect(() => readConfig({ ...environment, REDIS_URL: "https://example.test" })).toThrow("REDIS_URL");
    try {
      readConfig({ ...environment, DATABASE_URL: "secret-not-a-url" });
    } catch (error) {
      expect(String(error)).not.toContain("secret-not-a-url");
    }
  });
});
