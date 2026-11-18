import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import { resolveRoute } from "../src/routing.js";

describe("gateway routing", () => {
  it("routes each public surface to its owning service", () => {
    expect(resolveRoute("/api/v1/auth/login")).toBe("identity");
    expect(resolveRoute("/api/v1/me")).toBe("identity");
    expect(resolveRoute("/api/v1/members/1/password")).toBe("identity");
    expect(resolveRoute("/api/v1/auth/signup")).toBe("identity");
    expect(resolveRoute("/api/v1/organization/members")).toBe("identity");
    expect(resolveRoute("/api/v1/organization/teams")).toBe("identity");
    expect(resolveRoute("/api/v1/organizations")).toBe("identity");
    expect(resolveRoute("/api/v1/invitations")).toBe("identity");
    expect(resolveRoute("/api/v1/invitations/token/abc/accept")).toBe("identity");
    expect(resolveRoute("/api/v1/invitationsx")).toBeUndefined();
    expect(resolveRoute("/api/v1/projects/1/tasks")).toBe("projects");
    expect(resolveRoute("/api/v1/tasks/1/status")).toBe("projects");
    expect(resolveRoute("/api/v1/notification-preferences/email")).toBe("notifications");
    expect(resolveRoute("/api/v1/audit/summary")).toBe("audit");
    expect(resolveRoute("/mcp")).toBe("mcp");
    expect(resolveRoute("/mcp/messages")).toBe("mcp");
  });

  it("routes the OAuth surface of MCP clients", () => {
    expect(resolveRoute("/.well-known/oauth-protected-resource/mcp")).toBe("mcp");
    expect(resolveRoute("/.well-known/oauth-protected-resource")).toBe("mcp");
    expect(resolveRoute("/.well-known/oauth-authorization-server/identity")).toBe("identity");
    expect(resolveRoute("/.well-known/openid-configuration/identity")).toBe("identity");
    expect(resolveRoute("/identity/.well-known/oauth-authorization-server")).toBe("identity");
    expect(resolveRoute("/identity/.well-known/openid-configuration")).toBe("identity");
    expect(resolveRoute("/identity/.well-known/jwks.json")).toBe("identity");
    expect(resolveRoute("/identity/oauth/authorize")).toBe("identity");
    expect(resolveRoute("/identity/oauth/token")).toBe("identity");
    expect(resolveRoute("/identity/oauth/register")).toBe("identity");
    expect(resolveRoute("/identity/oauth/revoke")).toBe("identity");
    expect(resolveRoute("/identityx")).toBeUndefined();
    expect(resolveRoute("/.well-known/security.txt")).toBeUndefined();
  });

  it("keeps health and unknown paths local", () => {
    expect(resolveRoute("/api/v1/health")).toBeUndefined();
    expect(resolveRoute("/api/v1/health/ready")).toBeUndefined();
    expect(resolveRoute("/api/v1/tasksomething")).toBeUndefined();
    expect(resolveRoute("/ws")).toBeUndefined();
  });

  it("reads the number of proxies trusted in front of the gateway", () => {
    expect(readConfig({}).GATEWAY_TRUST_PROXY).toBe(0);
    expect(readConfig({ GATEWAY_TRUST_PROXY: "1" }).GATEWAY_TRUST_PROXY).toBe(1);
    expect(() => readConfig({ GATEWAY_TRUST_PROXY: "true" })).toThrow(/GATEWAY_TRUST_PROXY/);
    expect(() => readConfig({ GATEWAY_TRUST_PROXY: "-1" })).toThrow(/GATEWAY_TRUST_PROXY/);
  });

  it("requires HTTPS for every upstream in production", () => {
    expect(() =>
      readConfig({
        NODE_ENV: "production",
        PROJECTS_API_URL: "http://projects:3001",
      }),
    ).toThrow(/PROJECTS_API_URL/);
    expect(
      readConfig({
        NODE_ENV: "production",
        PROJECTS_API_URL: "https://projects",
        IDENTITY_API_URL: "https://identity",
        NOTIFICATIONS_API_URL: "https://notifications",
        REALTIME_API_URL: "https://realtime",
        AUDIT_API_URL: "https://audit",
        MCP_API_URL: "https://mcp",
      }).GATEWAY_PORT,
    ).toBe(3000);
  });
});
