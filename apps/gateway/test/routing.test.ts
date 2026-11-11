import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import { resolveRoute } from "../src/routing.js";

describe("gateway routing", () => {
  it("routes each public surface to its owning service", () => {
    expect(resolveRoute("/api/v1/auth/login")).toBe("identity");
    expect(resolveRoute("/api/v1/me")).toBe("identity");
    expect(resolveRoute("/api/v1/members/1/password")).toBe("identity");
    expect(resolveRoute("/api/v1/projects/1/tasks")).toBe("projects");
    expect(resolveRoute("/api/v1/tasks/1/status")).toBe("projects");
    expect(resolveRoute("/api/v1/notification-preferences/email")).toBe("notifications");
    expect(resolveRoute("/api/v1/audit/summary")).toBe("audit");
    expect(resolveRoute("/mcp")).toBe("mcp");
    expect(resolveRoute("/mcp/messages")).toBe("mcp");
  });

  it("keeps health and unknown paths local", () => {
    expect(resolveRoute("/api/v1/health")).toBeUndefined();
    expect(resolveRoute("/api/v1/health/ready")).toBeUndefined();
    expect(resolveRoute("/api/v1/tasksomething")).toBeUndefined();
    expect(resolveRoute("/ws")).toBeUndefined();
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
