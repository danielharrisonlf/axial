import { describe, expect, it } from "vitest";
import { ALL_SCOPES, grantedScopes, ROLE_SCOPES } from "../src/scopes.js";

describe("scopes", () => {
  it("grants each role the ceiling its upstream permissions allow", () => {
    expect(ROLE_SCOPES.ADMIN).toEqual(ALL_SCOPES);
    expect(ROLE_SCOPES.VIEWER).not.toContain("projects:write");
    expect(ROLE_SCOPES.CONTRIBUTOR).toContain("projects:write");
    expect(ROLE_SCOPES.CONTRIBUTOR).not.toContain("audit:read");
    expect(ROLE_SCOPES.TEAM_LEAD).toContain("audit:read");
    expect(ROLE_SCOPES.PROJECT_MANAGER).not.toContain("identity:write");
  });

  it("uses the role ceiling when the token has no scope claim", () => {
    expect(grantedScopes("VIEWER", undefined)).toEqual(ROLE_SCOPES.VIEWER);
  });

  it("narrows with the scope claim and never widens the role", () => {
    expect(grantedScopes("ADMIN", "projects:read  audit:read unknown:scope")).toEqual([
      "projects:read",
      "audit:read",
    ]);
    expect(grantedScopes("VIEWER", "projects:read projects:write identity:write")).toEqual(["projects:read"]);
    expect(grantedScopes("ADMIN", "")).toEqual([]);
  });
});
