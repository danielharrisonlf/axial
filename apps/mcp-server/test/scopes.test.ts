import { describe, expect, it } from "vitest";
import { grantedScopes } from "../src/scopes.js";

const resource = "https://api.kairos.noxlabs.tech/mcp";

describe("token scopes", () => {
  it("keeps full access for first-party tokens without a scope claim", () => {
    expect(grantedScopes({ aud: "axial-projects" }, resource)).toEqual(["projects:read", "projects:write"]);
  });

  it("limits OAuth tokens to their granted scopes", () => {
    expect(grantedScopes({ aud: ["axial-projects", resource], scope: "projects:read" }, resource)).toEqual([
      "projects:read",
    ]);
    expect(grantedScopes({ aud: ["axial-projects", resource], scope: "openid other" }, resource)).toEqual([]);
  });

  it("refuses OAuth tokens issued for another resource", () => {
    expect(grantedScopes({ aud: "axial-projects", scope: "projects:read" }, resource)).toBeUndefined();
    expect(
      grantedScopes({ aud: ["axial-projects", "https://other/mcp"], scope: "projects:read" }, resource),
    ).toBeUndefined();
  });
});
