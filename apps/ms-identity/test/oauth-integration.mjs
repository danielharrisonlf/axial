// Run from apps/ms-identity: IDENTITY_TEST_DATABASE_URL must name a *_test database whose
// user has CREATEDB. A disposable database is created and dropped for this run.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importSPKI, jwtVerify } from "jose";
import pg from "pg";

const url = process.env.IDENTITY_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("IDENTITY_TEST_DATABASE_URL must name a _test database");
const admin = new pg.Pool({ connectionString: url });
const poolErrors = [];
admin.on("error", (error) => poolErrors.push(error));
const databaseName = `axial_identity_oauth_${randomUUID().replaceAll("-", "")}_test`;
const testUrl = new URL(url);
testUrl.pathname = `/${databaseName}`;
const db = new pg.Pool({ connectionString: testUrl.toString() });
db.on("error", (error) => poolErrors.push(error));
const dir = mkdtempSync(join(tmpdir(), "identity-oauth-test-"));
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
writeFileSync(join(dir, "private.pem"), privateKey);
writeFileSync(join(dir, "public.pem"), publicKey);
const issuer = "http://localhost:3000/identity";
const resource = "http://localhost:3000/mcp";
const port = 3203;
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: "test",
  IDENTITY_DATABASE_URL: testUrl.toString(),
  IDENTITY_PRIVATE_KEY_PATH: join(dir, "private.pem"),
  IDENTITY_PUBLIC_KEY_PATH: join(dir, "public.pem"),
  IDENTITY_ISSUER: issuer,
  IDENTITY_AUDIENCE: "axial-projects",
  IDENTITY_OAUTH_RESOURCE: resource,
  BETTER_AUTH_SECRET: "integration-secret-with-at-least-32-chars",
  BETTER_AUTH_URL: base,
  IDENTITY_TRUSTED_ORIGINS: "http://localhost:5173",
  IDENTITY_PORT: String(port),
  // Called directly: X-Forwarded-For is not trusted.
  IDENTITY_TRUST_PROXY: "0",
  IDENTITY_BOOTSTRAP_EMAIL: "admin@example.test",
  IDENTITY_BOOTSTRAP_PASSWORD: "a-secure-test-password",
  IDENTITY_BOOTSTRAP_ORGANIZATION: "Alpha organization",
};
let server;
let serverClosed;
let created = false;
let failure;
const cleanupErrors = [];

async function waitForConnections(name) {
  for (let i = 0; i < 100; i++) {
    const result = await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1", [
      name,
    ]);
    if (result.rows[0].count === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Connections remain open for test database ${name}`);
}

async function api(path, body, token, method = "POST") {
  const response = await fetch(`${base}/api/v1/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

async function form(path, fields, headers = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function hidden(html) {
  const fields = {};
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g))
    fields[match[1]] = match[2].replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
  return fields;
}

const redirectUri = "http://127.0.0.1:43123/callback";

/** Opens the consent page and returns its form fields and CSRF cookie. */
async function openConsent(clientId, challenge, extra = {}) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "projects:read projects:write",
    state: "state-123",
    resource,
    ...extra,
  });
  const page = await fetch(`${base}/identity/oauth/authorize?${query}`, { redirect: "manual" });
  assert.equal(page.status, 200);
  const cookie = page.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("kairos_oauth_csrf="), "consent page sets the CSRF cookie");
  assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  return { html: await page.text(), cookie };
}

/** Logs in through the consent form and returns the authorization code. */
async function authorize(clientId, user, password, organization) {
  const { verifier, challenge } = pkce();
  const { html, cookie } = await openConsent(clientId, challenge);
  let response = await form(
    "/identity/oauth/authorize",
    { ...hidden(html), email: user, password, decision: "allow" },
    { cookie },
  );
  if (response.status === 200) {
    const selection = await response.text();
    assert.match(selection, /Escolha a organização/);
    response = await form(
      "/identity/oauth/authorize",
      { ...hidden(selection), organizationId: organization, decision: "allow" },
      { cookie },
    );
  }
  assert.equal(response.status, 303, `authorize failed with ${response.status}`);
  const location = new URL(response.headers.get("location"));
  assert.equal(`${location.origin}${location.pathname}`, redirectUri);
  assert.equal(location.searchParams.get("state"), "state-123");
  assert.equal(location.searchParams.get("iss"), issuer);
  return { code: location.searchParams.get("code"), verifier };
}

async function token(fields) {
  const response = await form("/identity/oauth/token", fields);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return { status: response.status, body: await response.json() };
}

try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  for (const file of ["src/migrate.ts", "src/bootstrap.ts"]) {
    const run = spawnSync(process.execPath, ["--import", "tsx", file], { env, encoding: "utf8" });
    if (run.status !== 0) throw new Error(run.stderr || run.stdout);
  }
  const alpha = (await db.query("SELECT id FROM identity.organizations LIMIT 1")).rows[0].id;
  server = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], { env, stdio: "inherit" });
  serverClosed = new Promise((resolve) => {
    server.once("error", (error) => {
      poolErrors.push(error);
      resolve();
    });
    server.once("close", resolve);
  });
  let ready = false;
  // A cold tsx start compiles the service first; allow up to 30 seconds.
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`${base}/api/v1/health/ready`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "server failed to start");

  // Accounts: the administrator belongs to two organizations, the member to one.
  const adminLogin = await api("auth/login", {
    email: "admin@example.test",
    password: "a-secure-test-password",
    organizationId: alpha,
  });
  assert.equal(adminLogin.status, 201);
  const beta = (await api("organizations", { name: "Beta organization" }, adminLogin.body.accessToken)).body
    .id;
  const member = await api(
    "members",
    { email: "member@example.test", password: "member-temporary-password", role: "CONTRIBUTOR" },
    adminLogin.body.accessToken,
  );
  assert.equal(member.status, 201);
  assert.equal(
    (
      await api(
        "members",
        { email: "temporary@example.test", password: "temporary-password-value", role: "VIEWER" },
        adminLogin.body.accessToken,
      )
    ).status,
    201,
  );
  const memberTemporary = await api("auth/login", {
    email: "member@example.test",
    password: "member-temporary-password",
    organizationId: alpha,
  });
  assert.equal(
    (
      await api(
        "auth/password",
        { currentPassword: "member-temporary-password", newPassword: "member-private-password" },
        memberTemporary.body.accessToken,
      )
    ).status,
    201,
  );

  // Metadata (RFC 8414 and OpenID discovery paths) and JWKS.
  for (const path of [
    "/.well-known/oauth-authorization-server/identity",
    "/.well-known/openid-configuration/identity",
    "/identity/.well-known/oauth-authorization-server",
    "/identity/.well-known/openid-configuration",
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    const metadata = await response.json();
    assert.equal(metadata.issuer, issuer);
    assert.equal(metadata.authorization_endpoint, `${issuer}/oauth/authorize`);
    assert.equal(metadata.token_endpoint, `${issuer}/oauth/token`);
    assert.equal(metadata.registration_endpoint, `${issuer}/oauth/register`);
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none"]);
  }
  const jwks = await (await fetch(`${base}/identity/.well-known/jwks.json`)).json();
  assert.equal(jwks.keys[0].kty, "RSA");
  assert.equal(jwks.keys[0].d, undefined, "JWKS publishes only the public key");
  assert.equal((await fetch(`${base}/api/v1/identity/oauth/token`, { method: "POST" })).status, 404);

  // Dynamic client registration (RFC 7591).
  const register = async (body) => {
    const response = await fetch(`${base}/identity/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal(
    (await register({ redirect_uris: ["http://evil.example/cb"] })).body.error,
    "invalid_redirect_uri",
  );
  assert.equal((await register({ redirect_uris: ["javascript:alert(1)"] })).status, 400);
  assert.equal((await register({ redirect_uris: [] })).body.error, "invalid_redirect_uri");
  assert.equal((await register({ client_name: "No redirects" })).status, 400);
  assert.equal(
    (await register({ redirect_uris: [redirectUri], grant_types: ["client_credentials"] })).body.error,
    "invalid_client_metadata",
  );
  const registered = await register({
    client_name: "Claude <Test>",
    redirect_uris: [
      redirectUri,
      "cursor://anysphere.cursor-mcp/oauth/callback",
      "https://claude.ai/api/mcp/auth_callback",
    ],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "client_secret_post",
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.token_endpoint_auth_method, "none");
  assert.equal(registered.body.client_secret, undefined);
  const clientId = registered.body.client_id;
  const otherClient = (await register({ redirect_uris: [redirectUri] })).body.client_id;

  // Authorization request errors: unknown client and unregistered redirect stay on the page.
  const { challenge } = pkce();
  const unknownClient = await fetch(
    `${base}/identity/oauth/authorize?response_type=code&client_id=missing&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${challenge}&code_challenge_method=S256`,
    { redirect: "manual" },
  );
  assert.equal(unknownClient.status, 400);
  assert.equal(unknownClient.headers.get("location"), null);
  const badRedirect = await fetch(
    `${base}/identity/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&code_challenge=${challenge}&code_challenge_method=S256`,
    { redirect: "manual" },
  );
  assert.equal(badRedirect.status, 400);
  assert.equal(badRedirect.headers.get("location"), null);
  const redirected = async (params) => {
    const response = await fetch(
      `${base}/identity/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "s",
        ...params,
      })}`,
      { redirect: "manual" },
    );
    assert.equal(response.status, 303);
    return new URL(response.headers.get("location")).searchParams;
  };
  assert.equal((await redirected({ code_challenge_method: "plain" })).get("error"), "invalid_request");
  assert.equal((await redirected({ resource: "https://other.example/mcp" })).get("error"), "invalid_target");
  assert.equal((await redirected({ response_type: "token" })).get("error"), "unsupported_response_type");
  // A loopback redirect may use another port (RFC 8252 §7.3).
  const otherPort = await fetch(
    `${base}/identity/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "http://127.0.0.1:50000/callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
    })}`,
    { redirect: "manual" },
  );
  assert.equal(otherPort.status, 200);

  // Consent form: CSRF, cancellation, wrong password and provisional password.
  const consent = await openConsent(clientId, challenge);
  assert.match(consent.html, /Conectar Claude &lt;Test&gt; ao Kairos/);
  assert.match(consent.html, /127\.0\.0\.1:43123/);
  const fields = hidden(consent.html);
  assert.equal(fields.resource, resource);
  assert.equal(
    (
      await form("/identity/oauth/authorize", {
        ...fields,
        email: "member@example.test",
        password: "member-private-password",
      })
    ).status,
    403,
    "a form without the CSRF cookie is refused",
  );
  assert.equal(
    (
      await form(
        "/identity/oauth/authorize",
        {
          ...fields,
          csrf: "x".repeat(43),
          email: "member@example.test",
          password: "member-private-password",
        },
        { cookie: consent.cookie },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await form(
        "/identity/oauth/authorize",
        { ...fields, email: "member@example.test", password: "member-private-password" },
        { cookie: consent.cookie, "sec-fetch-site": "cross-site" },
      )
    ).status,
    403,
  );
  const denied = await form(
    "/identity/oauth/authorize",
    { ...fields, decision: "deny" },
    { cookie: consent.cookie },
  );
  assert.equal(denied.status, 303);
  const deniedParams = new URL(denied.headers.get("location")).searchParams;
  assert.equal(deniedParams.get("error"), "access_denied");
  assert.equal(deniedParams.get("state"), "state-123");
  const wrongPassword = await form(
    "/identity/oauth/authorize",
    { ...fields, email: "member@example.test", password: "not-the-password" },
    { cookie: consent.cookie },
  );
  assert.equal(wrongPassword.status, 401);
  assert.match(await wrongPassword.text(), /E-mail ou senha incorretos/);
  const provisional = await form(
    "/identity/oauth/authorize",
    { ...fields, email: "temporary@example.test", password: "temporary-password-value" },
    { cookie: consent.cookie },
  );
  assert.equal(provisional.status, 403);
  assert.match(await provisional.text(), /senha atual é provisória/);

  // Code + PKCE flow and its failure modes.
  const publicVerifier = await importSPKI(publicKey, "RS256");
  const first = await authorize(clientId, "member@example.test", "member-private-password");
  const wrongVerifier = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    code: first.code,
    code_verifier: pkce().verifier,
    redirect_uri: redirectUri,
  });
  assert.equal(wrongVerifier.status, 400);
  assert.equal(wrongVerifier.body.error, "invalid_grant");

  const second = await authorize(clientId, "member@example.test", "member-private-password");
  assert.equal(
    (
      await token({
        grant_type: "authorization_code",
        client_id: otherClient,
        code: second.code,
        code_verifier: second.verifier,
        redirect_uri: redirectUri,
      })
    ).body.error,
    "invalid_grant",
    "a code is bound to its client",
  );

  const third = await authorize(clientId, "member@example.test", "member-private-password");
  const mismatch = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    code: third.code,
    code_verifier: third.verifier,
    redirect_uri: "http://127.0.0.1:43123/other",
  });
  assert.equal(mismatch.body.error, "invalid_grant");

  const expired = await authorize(clientId, "member@example.test", "member-private-password");
  await db.query("UPDATE identity.oauth_authorization_codes SET expires_at=now() - interval '1 second'");
  assert.equal(
    (
      await token({
        grant_type: "authorization_code",
        client_id: clientId,
        code: expired.code,
        code_verifier: expired.verifier,
        redirect_uri: redirectUri,
      })
    ).body.error,
    "invalid_grant",
  );
  assert.equal(
    (await token({ grant_type: "password", client_id: clientId })).body.error,
    "unsupported_grant_type",
  );
  assert.equal((await token({ grant_type: "authorization_code", client_id: "missing" })).status, 401);

  const good = await authorize(clientId, "member@example.test", "member-private-password");
  const issued = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    code: good.code,
    code_verifier: good.verifier,
    redirect_uri: redirectUri,
    resource,
  });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.equal(issued.body.token_type, "Bearer");
  assert.equal(issued.body.expires_in, 3600);
  assert.equal(issued.body.scope, "projects:read projects:write");
  assert.ok(issued.body.refresh_token);
  const { payload } = await jwtVerify(issued.body.access_token, publicVerifier, {
    algorithms: ["RS256"],
    issuer,
    audience: "axial-projects",
  });
  assert.deepEqual(payload.aud, ["axial-projects", resource]);
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(payload.scope, "projects:read projects:write");
  assert.equal(payload.client_id, clientId);
  assert.equal(payload.organizationId, alpha);
  assert.equal(payload.role, "CONTRIBUTOR");
  assert.equal(payload.source, "mcp");
  assert.equal(payload.sub, member.body.id);
  assert.equal(
    (await api("me", null, issued.body.access_token, "GET")).status,
    401,
    "delegated tokens are refused by the identity API",
  );
  const stored = await db.query("SELECT token_hash FROM identity.oauth_refresh_tokens");
  assert.ok(
    stored.rows.every((row) => row.token_hash !== issued.body.refresh_token),
    "only hashes are stored",
  );

  // Code reuse revokes the tokens it produced.
  const reused = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    code: good.code,
    code_verifier: good.verifier,
    redirect_uri: redirectUri,
  });
  assert.equal(reused.body.error, "invalid_grant");
  assert.equal(
    (
      await token({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: issued.body.refresh_token,
      })
    ).body.error,
    "invalid_grant",
  );

  // Refresh rotation and reuse detection.
  const fresh = await authorize(clientId, "member@example.test", "member-private-password");
  const start = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    code: fresh.code,
    code_verifier: fresh.verifier,
    redirect_uri: redirectUri,
  });
  assert.equal(start.status, 200);
  const narrowed = await token({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: start.body.refresh_token,
    scope: "projects:read",
  });
  assert.equal(narrowed.status, 200, JSON.stringify(narrowed.body));
  assert.equal(narrowed.body.scope, "projects:read");
  assert.notEqual(narrowed.body.refresh_token, start.body.refresh_token);
  const rotated = await token({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: narrowed.body.refresh_token,
  });
  assert.equal(rotated.status, 200);
  assert.equal(
    rotated.body.scope,
    "projects:read projects:write",
    "the refresh token keeps the original grant",
  );
  assert.equal(
    (
      await token({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: rotated.body.refresh_token,
        scope: "projects:admin",
      })
    ).body.error,
    "invalid_scope",
  );
  const replay = await token({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: start.body.refresh_token,
  });
  assert.equal(replay.body.error, "invalid_grant");
  assert.equal(
    (
      await token({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: rotated.body.refresh_token,
      })
    ).body.error,
    "invalid_grant",
    "reuse revokes the whole family",
  );

  // Revocation endpoint (RFC 7009).
  const revocable = await authorize(clientId, "member@example.test", "member-private-password");
  const revocableTokens = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    code: revocable.code,
    code_verifier: revocable.verifier,
    redirect_uri: redirectUri,
  });
  const revoked = await form("/identity/oauth/revoke", {
    token: revocableTokens.body.refresh_token,
    client_id: clientId,
  });
  assert.equal(revoked.status, 200);
  assert.equal(
    (
      await token({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: revocableTokens.body.refresh_token,
      })
    ).body.error,
    "invalid_grant",
  );

  // Several organizations: the account chooses one after the password.
  const multi = await authorize(clientId, "admin@example.test", "a-secure-test-password", beta);
  const multiTokens = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    code: multi.code,
    code_verifier: multi.verifier,
    redirect_uri: redirectUri,
  });
  assert.equal(multiTokens.status, 200);
  const multiClaims = (
    await jwtVerify(multiTokens.body.access_token, publicVerifier, { issuer, audience: "axial-projects" })
  ).payload;
  assert.equal(multiClaims.organizationId, beta);
  assert.equal(multiClaims.role, "ADMIN");

  // A revoked membership loses access on the next refresh.
  const before = await authorize(clientId, "member@example.test", "member-private-password");
  const beforeTokens = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    code: before.code,
    code_verifier: before.verifier,
    redirect_uri: redirectUri,
  });
  assert.equal(beforeTokens.status, 200);
  assert.equal(
    (await api(`members/${member.body.id}`, { active: false }, adminLogin.body.accessToken, "PATCH")).status,
    200,
  );
  assert.equal(
    (
      await token({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: beforeTokens.body.refresh_token,
      })
    ).body.error,
    "invalid_grant",
  );
  const revokedFamily = await db.query(
    "SELECT count(*)::int AS count FROM identity.oauth_refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL AND rotated_at IS NULL",
    [member.body.id],
  );
  assert.equal(revokedFamily.rows[0].count, 0);

  // The login form shares the per-IP authentication limit.
  const limited = await openConsent(clientId, challenge);
  let throttled;
  for (let i = 0; i < 25 && !throttled; i++) {
    const attempt = await form(
      "/identity/oauth/authorize",
      { ...hidden(limited.html), email: "admin@example.test", password: "wrong-password-value" },
      { cookie: limited.cookie },
    );
    if (attempt.status === 429) throttled = await attempt.text();
    else assert.equal(attempt.status, 401);
  }
  assert.ok(throttled, "the login form is rate limited");
  assert.match(throttled, /Muitas tentativas/);
  // Without IDENTITY_TRUST_PROXY a forged X-Forwarded-For does not open a new bucket.
  const forged = await form(
    "/identity/oauth/authorize",
    { ...hidden(limited.html), email: "admin@example.test", password: "wrong-password-value" },
    { cookie: limited.cookie, "x-forwarded-for": "203.0.113.50" },
  );
  assert.equal(forged.status, 429);

  console.log(
    "OAuth integration passed: metadata, registration, consent/CSRF, code+PKCE, reuse, expiry, rotation, revocation, organizations and rate limit",
  );
} catch (error) {
  failure = error;
} finally {
  const cleanup = async (operation) => {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(error);
    }
  };
  await cleanup(async () => {
    if (server) {
      if (server.exitCode === null && server.signalCode === null) server.kill();
      await serverClosed;
    }
  });
  await cleanup(() => db.end());
  if (created)
    await cleanup(async () => {
      await waitForConnections(databaseName);
      await admin.query(`DROP DATABASE "${databaseName}"`);
    });
  await cleanup(() => admin.end());
  await cleanup(() => rmSync(dir, { recursive: true, force: true }));
}
const errors = [...(failure ? [failure] : []), ...cleanupErrors, ...poolErrors];
if (errors.length) throw new AggregateError(errors, "OAuth integration test or cleanup failed");
