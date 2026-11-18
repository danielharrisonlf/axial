import { describe, expect, it } from "vitest";
import {
  authorizationServerMetadata,
  grantedScopes,
  isAllowedRedirectUri,
  issuerServesOAuth,
  narrowScopes,
  parseCookies,
  pkceChallenge,
  redirectUriMatches,
  redirectWith,
  requestFingerprint,
  sameResource,
  signLoginTicket,
  verifyLoginTicket,
  verifyPkce,
} from "../src/oauth.js";
import { escapeHtml, renderAuthorizePage } from "../src/oauth-page.js";

describe("authorization server metadata", () => {
  it("derives every endpoint from the issuer and advertises PKCE S256 for public clients", () => {
    const metadata = authorizationServerMetadata("https://api.kairos.noxlabs.tech/identity");
    expect(metadata).toMatchObject({
      issuer: "https://api.kairos.noxlabs.tech/identity",
      authorization_endpoint: "https://api.kairos.noxlabs.tech/identity/oauth/authorize",
      token_endpoint: "https://api.kairos.noxlabs.tech/identity/oauth/token",
      registration_endpoint: "https://api.kairos.noxlabs.tech/identity/oauth/register",
      revocation_endpoint: "https://api.kairos.noxlabs.tech/identity/oauth/revoke",
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      response_types_supported: ["code"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["projects:read", "projects:write"],
    });
  });

  it("is served only when the issuer path is the one the routes are mounted on", () => {
    expect(issuerServesOAuth("https://api.kairos.noxlabs.tech/identity")).toBe(true);
    expect(issuerServesOAuth("https://api.kairos.noxlabs.tech/auth")).toBe(false);
    expect(issuerServesOAuth("https://api.kairos.noxlabs.tech/identity/")).toBe(false);
    expect(issuerServesOAuth("https://identity.example.test")).toBe(false);
  });
});

describe("redirect URIs", () => {
  it("accepts HTTPS, loopback HTTP and native app schemes used by MCP clients", () => {
    for (const uri of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "http://localhost:54321/callback",
      "http://127.0.0.1:33418/",
      "http://[::1]:8080/cb",
      "cursor://anysphere.cursor-mcp/oauth/callback",
      "com.example.app:/oauth2redirect",
    ])
      expect(isAllowedRedirectUri(uri), uri).toBe(true);
  });

  it("refuses remote HTTP, script schemes, fragments and embedded credentials", () => {
    for (const uri of [
      "http://evil.example/callback",
      "http://localhost.evil.example/cb",
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "https://claude.ai/cb#fragment",
      "https://user:pass@claude.ai/cb",
      "not a url",
    ])
      expect(isAllowedRedirectUri(uri), uri).toBe(false);
  });

  it("matches exactly, letting only the loopback port vary", () => {
    expect(redirectUriMatches("https://claude.ai/cb", "https://claude.ai/cb")).toBe(true);
    expect(redirectUriMatches("https://claude.ai/cb", "https://claude.ai/cb2")).toBe(false);
    expect(redirectUriMatches("http://127.0.0.1:1000/cb", "http://127.0.0.1:2000/cb")).toBe(true);
    expect(redirectUriMatches("http://127.0.0.1:1000/cb", "http://127.0.0.1:2000/other")).toBe(false);
    expect(redirectUriMatches("http://localhost:1000/cb", "http://127.0.0.1:1000/cb")).toBe(false);
  });

  it("adds response parameters to the redirect URI", () => {
    const location = new URL(redirectWith("https://claude.ai/cb?x=1", { code: "abc", state: undefined }));
    expect(location.searchParams.get("x")).toBe("1");
    expect(location.searchParams.get("code")).toBe("abc");
    expect(location.searchParams.has("state")).toBe(false);
  });
});

describe("PKCE and scopes", () => {
  it("verifies the S256 challenge of RFC 7636 appendix B", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(pkceChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(verifyPkce(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(verifyPkce(`${verifier}x`, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
    expect(verifyPkce("short", pkceChallenge("short"))).toBe(false);
  });

  it("grants the known requested scopes, or every scope when none is known", () => {
    expect(grantedScopes("projects:read")).toEqual(["projects:read"]);
    expect(grantedScopes("openid projects:write")).toEqual(["projects:write"]);
    expect(grantedScopes(undefined)).toEqual(["projects:read", "projects:write"]);
    expect(narrowScopes("projects:read projects:write", "projects:read")).toBe("projects:read");
    expect(narrowScopes("projects:read", "projects:read projects:write")).toBeUndefined();
    expect(narrowScopes("projects:read", undefined)).toBe("projects:read");
  });

  it("compares resources ignoring one trailing slash", () => {
    expect(sameResource("https://api.example/mcp", "https://api.example/mcp/")).toBe(true);
    expect(sameResource("https://api.example/mcp", "https://api.example/other")).toBe(false);
  });
});

describe("login ticket", () => {
  const fingerprint = requestFingerprint("client", "https://claude.ai/cb", "challenge");
  it("is bound to the CSRF cookie, the request and an expiry", () => {
    const ticket = signLoginTicket("secret", "user-1", "csrf-1", fingerprint, 1_000_000);
    expect(verifyLoginTicket("secret", ticket, "csrf-1", fingerprint, 1_000_000)).toBe("user-1");
    expect(verifyLoginTicket("secret", ticket, "csrf-2", fingerprint, 1_000_000)).toBeUndefined();
    expect(verifyLoginTicket("other", ticket, "csrf-1", fingerprint, 1_000_000)).toBeUndefined();
    expect(
      verifyLoginTicket("secret", ticket, "csrf-1", requestFingerprint("x", "y", "z"), 1_000_000),
    ).toBeUndefined();
    expect(verifyLoginTicket("secret", ticket, "csrf-1", fingerprint, 1_000_000 + 301_000)).toBeUndefined();
    expect(verifyLoginTicket("secret", `${ticket}x`, "csrf-1", fingerprint, 1_000_000)).toBeUndefined();
  });
});

describe("consent page", () => {
  it("escapes the client-provided name and keeps the request in hidden fields", () => {
    const html = renderAuthorizePage({
      clientName: '<script>alert("x")</script>',
      redirectHost: "claude.ai",
      scopes: ["projects:read"],
      hidden: { client_id: "abc", csrf: 'a"b' },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain(escapeHtml('<script>alert("x")</script>'));
    expect(html).toContain('name="csrf" value="a&quot;b"');
    expect(html).toContain("Permitir acesso");
    expect(html).toContain('lang="pt-BR"');
  });

  it("parses cookies without failing on malformed values", () => {
    const cookies = parseCookies("a=1; kairos_oauth_csrf=abc%20d; bad=%E0%A4%A");
    expect(cookies.get("kairos_oauth_csrf")).toBe("abc d");
    expect(cookies.has("bad")).toBe(false);
  });
});
