import { describe, expect, it } from "vitest";
import { invitationUrl, readSettings, sessionTokenFromCookie } from "../src/settings.js";

describe("identity settings", () => {
  it("defaults to a direct connection, closed signup and secure cookies", () => {
    const settings = readSettings({});
    expect(settings.IDENTITY_TRUST_PROXY).toBe(0);
    expect(settings.IDENTITY_SIGNUP_ENABLED).toBe(false);
    expect(settings.IDENTITY_SESSION_COOKIE_SECURE).toBe(true);
    expect(settings.IDENTITY_WEB_URL).toBe("http://localhost:5173");
    expect(settings.IDENTITY_TRUSTED_ORIGINS).toEqual(["http://localhost:5173"]);
  });

  it("trusts a fixed number of proxy hops, never every hop", () => {
    expect(readSettings({ IDENTITY_TRUST_PROXY: "1" }).IDENTITY_TRUST_PROXY).toBe(1);
    expect(readSettings({ IDENTITY_TRUST_PROXY: "false" }).IDENTITY_TRUST_PROXY).toBe(0);
    expect(() => readSettings({ IDENTITY_TRUST_PROXY: "true" })).toThrow(/IDENTITY_TRUST_PROXY/);
    expect(() => readSettings({ IDENTITY_TRUST_PROXY: "10.0.0.0/8" })).toThrow(/IDENTITY_TRUST_PROXY/);
  });

  it("reads the switches and the Workspace address", () => {
    const settings = readSettings({
      IDENTITY_SIGNUP_ENABLED: "true",
      IDENTITY_SESSION_COOKIE_SECURE: "false",
      IDENTITY_WEB_URL: "https://kairos.noxlabs.tech/",
      IDENTITY_TRUSTED_ORIGINS: "https://kairos.noxlabs.tech, http://localhost:5173",
    });
    expect(settings.IDENTITY_SIGNUP_ENABLED).toBe(true);
    expect(settings.IDENTITY_SESSION_COOKIE_SECURE).toBe(false);
    expect(settings.IDENTITY_WEB_URL).toBe("https://kairos.noxlabs.tech");
    expect(settings.IDENTITY_TRUSTED_ORIGINS).toEqual([
      "https://kairos.noxlabs.tech",
      "http://localhost:5173",
    ]);
    expect(() => readSettings({ IDENTITY_SIGNUP_ENABLED: "yes" })).toThrow(/IDENTITY_SIGNUP_ENABLED/);
    expect(() => readSettings({ IDENTITY_WEB_URL: "javascript:alert(1)" })).toThrow(/IDENTITY_WEB_URL/);
    expect(() => readSettings({ IDENTITY_WEB_URL: "https://kairos.noxlabs.tech/#/x" })).toThrow(
      /IDENTITY_WEB_URL/,
    );
  });

  it("builds the invitation link of the Workspace hash route", () => {
    expect(invitationUrl("https://kairos.noxlabs.tech", "abc_DEF-123")).toBe(
      "https://kairos.noxlabs.tech/#/convite/abc_DEF-123",
    );
  });

  it("accepts only token-shaped session cookies", () => {
    expect(sessionTokenFromCookie("A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6")).toBe(
      "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6",
    );
    expect(sessionTokenFromCookie(undefined)).toBeUndefined();
    expect(sessionTokenFromCookie("short")).toBeUndefined();
    expect(sessionTokenFromCookie("token with spaces and more text")).toBeUndefined();
    expect(sessionTokenFromCookie("token\r\nx-injected: 1abcdefghij")).toBeUndefined();
  });
});
