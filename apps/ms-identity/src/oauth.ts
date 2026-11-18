import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * OAuth 2.1 authorization server for MCP clients (Claude, ChatGPT, Cursor...):
 * RFC 8414 metadata, RFC 7591 dynamic registration of public clients, PKCE S256
 * (RFC 7636), resource indicators (RFC 8707) and refresh token rotation. This
 * module holds the protocol rules; the HTTP flow lives in main.ts.
 */

export const OAUTH_SCOPES = ["projects:read", "projects:write"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_TTL_SECONDS = 120;
export const LOGIN_TICKET_TTL_SECONDS = 300;
export const CSRF_COOKIE = "kairos_oauth_csrf";
export const MAX_REDIRECT_URIS = 10;

/** Public paths, without the `api/v1` global prefix. They follow the issuer path `/identity`. */
export const OAUTH_ROUTES = {
  authorize: "identity/oauth/authorize",
  token: "identity/oauth/token",
  register: "identity/oauth/register",
  revoke: "identity/oauth/revoke",
  jwks: "identity/.well-known/jwks.json",
} as const;

/**
 * RFC 8414 inserts the well-known segment before the issuer path; OpenID Connect
 * discovery and some clients append it instead. All four answer the same document.
 */
export const METADATA_ROUTES = [
  ".well-known/oauth-authorization-server/identity",
  ".well-known/openid-configuration/identity",
  "identity/.well-known/oauth-authorization-server",
  "identity/.well-known/openid-configuration",
] as const;

export const UNPREFIXED_ROUTES: string[] = [...Object.values(OAUTH_ROUTES), ...METADATA_ROUTES];

/** The routes above only sit under the issuer when its path is `/identity`. */
export function issuerServesOAuth(issuer: string): boolean {
  const url = new URL(issuer);
  return url.pathname === "/identity" && !url.search && !url.hash;
}

export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
    // Required by OpenID discovery parsers that read the openid-configuration path.
    // No ID token is issued: these describe the access token signature only.
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Private-use schemes without a reverse-domain form that known MCP clients register.
// Cursor registers cursor://anysphere.cursor-mcp/oauth/callback.
const NATIVE_APP_SCHEMES = new Set(["cursor"]);

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * HTTPS on any host, plain HTTP only on loopback (RFC 8252 §7.3), and private-use
 * schemes for native apps (RFC 8252 §7.1): reverse-domain names or the allowlist.
 * Fragments and embedded credentials are refused.
 */
export function isAllowedRedirectUri(value: string): boolean {
  if (value.length > 2000 || value.includes("#")) return false;
  const url = parseUrl(value);
  if (!url || url.username || url.password) return false;
  const scheme = url.protocol.slice(0, -1);
  if (scheme === "https") return url.hostname !== "";
  if (scheme === "http") return LOOPBACK_HOSTS.has(url.hostname);
  if (NATIVE_APP_SCHEMES.has(scheme)) return true;
  return /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(scheme);
}

/** Exact match, except loopback HTTP redirects, whose port may vary (RFC 8252 §7.3). */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  const a = parseUrl(registered);
  const b = parseUrl(requested);
  if (!a || !b || a.protocol !== "http:" || b.protocol !== "http:") return false;
  if (!LOOPBACK_HOSTS.has(a.hostname)) return false;
  return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search && !b.hash;
}

/** Host shown on the consent page, so the user sees where the code is sent. */
export function redirectDisplay(redirectUri: string): string {
  const url = parseUrl(redirectUri);
  if (!url) return redirectUri;
  return url.host || `${url.protocol}//`;
}

/** Granted scopes: the known ones requested, or every scope when none is known. */
export function grantedScopes(requested: string | undefined): OAuthScope[] {
  const asked = new Set((requested ?? "").split(" ").filter(Boolean));
  const known = OAUTH_SCOPES.filter((scope) => asked.has(scope));
  return known.length ? known : [...OAUTH_SCOPES];
}

/** A refresh may narrow the original grant, never widen it. Undefined means invalid_scope. */
export function narrowScopes(granted: string, requested: string | undefined): string | undefined {
  if (requested === undefined) return granted;
  const allowed = new Set(granted.split(" "));
  const asked = [...new Set(requested.split(" ").filter(Boolean))];
  if (!asked.length || asked.some((scope) => !allowed.has(scope))) return undefined;
  return OAUTH_SCOPES.filter((scope) => asked.includes(scope)).join(" ");
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function sameResource(a: string, b: string): boolean {
  return withoutTrailingSlash(a) === withoutTrailingSlash(b);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  return CODE_VERIFIER.test(verifier) && safeEqual(pkceChallenge(verifier), challenge);
}

/** 256-bit opaque secret for codes, refresh tokens and CSRF cookies. */
export function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Codes and refresh tokens are stored only as this hash. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Binds a login ticket to the authorization request it was issued for. */
export function requestFingerprint(clientId: string, redirectUri: string, codeChallenge: string): string {
  return createHash("sha256").update(`${clientId}\n${redirectUri}\n${codeChallenge}`).digest("base64url");
}

/**
 * After a correct password for an account in several organizations, the page asks
 * for the organization without asking for the password again. The ticket proves the
 * authentication; it is bound to the browser CSRF cookie and the request, and expires.
 */
export function signLoginTicket(
  secret: string,
  userId: string,
  csrf: string,
  fingerprint: string,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      u: userId,
      e: Math.floor(now / 1000) + LOGIN_TICKET_TTL_SECONDS,
      c: hashToken(csrf),
      f: fingerprint,
    }),
  ).toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyLoginTicket(
  secret: string,
  ticket: string,
  csrf: string,
  fingerprint: string,
  now = Date.now(),
): string | undefined {
  const [payload, mac, extra] = ticket.split(".");
  if (!payload || !mac || extra !== undefined) return undefined;
  if (!safeEqual(createHmac("sha256", secret).update(payload).digest("base64url"), mac)) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  const value = data as { u?: unknown; e?: unknown; c?: unknown; f?: unknown };
  if (typeof value.u !== "string" || typeof value.e !== "number") return undefined;
  if (value.e <= Math.floor(now / 1000)) return undefined;
  if (value.c !== hashToken(csrf) || value.f !== fingerprint) return undefined;
  return value.u;
}

/** RFC 6749 §4.1.2.1 error redirect, with the RFC 9207 issuer parameter. */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      // A malformed cookie value is ignored, as browsers would not have produced it.
    }
  }
  return cookies;
}

/** RFC 6749 error, answered as JSON by the token, registration and revocation endpoints. */
export class OAuthProtocolError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}
