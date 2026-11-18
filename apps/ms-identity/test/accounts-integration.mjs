// Run from apps/ms-identity: IDENTITY_TEST_DATABASE_URL must name a *_test database whose
// user has CREATEDB. A disposable database is created and dropped for this run. Covers the
// client address behind the gateway, organization choice at login, the browser session
// cookie, self-service signup, the directory and invitations.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const url = process.env.IDENTITY_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("IDENTITY_TEST_DATABASE_URL must name a _test database");
const admin = new pg.Pool({ connectionString: url });
const poolErrors = [];
admin.on("error", (error) => poolErrors.push(error));
const databaseName = `axial_identity_accounts_${randomUUID().replaceAll("-", "")}_test`;
const testUrl = new URL(url);
testUrl.pathname = `/${databaseName}`;
const db = new pg.Pool({ connectionString: testUrl.toString() });
db.on("error", (error) => poolErrors.push(error));
const dir = mkdtempSync(join(tmpdir(), "identity-accounts-test-"));
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
writeFileSync(join(dir, "private.pem"), privateKey);
writeFileSync(join(dir, "public.pem"), publicKey);
const port = 3204;
const base = `http://127.0.0.1:${port}`;
const web = "https://kairos.example.test";
const env = {
  ...process.env,
  NODE_ENV: "test",
  IDENTITY_DATABASE_URL: testUrl.toString(),
  IDENTITY_PRIVATE_KEY_PATH: join(dir, "private.pem"),
  IDENTITY_PUBLIC_KEY_PATH: join(dir, "public.pem"),
  IDENTITY_ISSUER: "http://localhost:3000/identity",
  IDENTITY_AUDIENCE: "axial-projects",
  IDENTITY_OAUTH_RESOURCE: "http://localhost:3000/mcp",
  BETTER_AUTH_SECRET: "integration-secret-with-at-least-32-chars",
  BETTER_AUTH_URL: base,
  IDENTITY_TRUSTED_ORIGINS: web,
  IDENTITY_WEB_URL: web,
  IDENTITY_PORT: String(port),
  // The test client plays the gateway: one trusted hop that names the client address.
  IDENTITY_TRUST_PROXY: "1",
  IDENTITY_SIGNUP_ENABLED: "true",
  IDENTITY_SESSION_COOKIE_SECURE: "true",
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

// Every section uses its own client address, so the per-client limits do not interfere.
let clientCounter = 0;
const nextClient = () => `198.51.100.${++clientCounter}`;
let client = nextClient();

async function call(path, { method = "POST", body, token, headers = {} } = {}) {
  const response = await fetch(`${base}/api/v1/${path}`, {
    method,
    headers: {
      "x-forwarded-for": client,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

const payload = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));

function sessionCookie(headers) {
  const cookie = headers.getSetCookie().find((value) => value.startsWith("kairos_session="));
  return cookie;
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

  // --- 1. Rate limits count per client address behind one trusted proxy.
  const limitedClient = nextClient();
  client = limitedClient;
  for (let i = 0; i < 20; i++)
    assert.equal(
      (await call("auth/login", { body: { email: "admin@example.test", password: "wrong-password" } }))
        .status,
      401,
    );
  assert.equal(
    (await call("auth/login", { body: { email: "admin@example.test", password: "wrong-password" } })).status,
    429,
  );
  // Entries before the last one were written by the client itself and are not trusted.
  client = `203.0.113.77, ${limitedClient}`;
  assert.equal(
    (await call("auth/login", { body: { email: "admin@example.test", password: "a-secure-test-password" } }))
      .status,
    429,
  );
  client = nextClient();
  const direct = await call("auth/login", {
    body: { email: "admin@example.test", password: "a-secure-test-password" },
  });
  assert.equal(direct.status, 201, "another client keeps its own limit");

  // --- 2. One membership: login without organizationId returns tokens; API clients get no cookie.
  assert.equal(direct.body.requiresPasswordChange, false);
  assert.equal(direct.body.expiresIn, 300);
  assert.ok(direct.body.sessionToken);
  assert.equal(payload(direct.body.accessToken).organizationId, alpha);
  assert.equal(payload(direct.body.accessToken).source, "api");
  assert.equal(sessionCookie(direct.headers), undefined);
  const adminToken = direct.body.accessToken;

  // --- 3. Browser login: HttpOnly, Secure, SameSite=Lax cookie on the API host; source=ui.
  const browser = await call("auth/login", {
    body: { email: "admin@example.test", password: "a-secure-test-password" },
    headers: { origin: web },
  });
  assert.equal(browser.status, 201);
  assert.equal(browser.headers.get("access-control-allow-origin"), web);
  assert.equal(browser.headers.get("access-control-allow-credentials"), "true");
  assert.equal(payload(browser.body.accessToken).source, "ui");
  const setCookie = sessionCookie(browser.headers);
  assert.ok(setCookie, "browser login sets the session cookie");
  assert.match(setCookie, /; HttpOnly/i);
  assert.match(setCookie, /; Secure/i);
  assert.match(setCookie, /; SameSite=Lax/i);
  assert.match(setCookie, /; Path=\/api\/v1\/auth/i);
  assert.doesNotMatch(setCookie, /; Domain=/i, "host-only cookie");
  const cookie = setCookie.split(";")[0];
  assert.equal(cookie, `kairos_session=${browser.body.sessionToken}`);

  const cookieExchange = await call("auth/session", { headers: { cookie, origin: web } });
  assert.equal(cookieExchange.status, 201);
  assert.equal(payload(cookieExchange.body.accessToken).source, "ui");
  assert.equal(payload(cookieExchange.body.accessToken).organizationId, alpha);
  // A stale access token sent along does not hide the session cookie.
  const withStaleToken = await call("auth/session", { token: browser.body.accessToken, headers: { cookie } });
  assert.equal(withStaleToken.status, 201);
  const bearerExchange = await call("auth/session", { token: direct.body.sessionToken });
  assert.equal(bearerExchange.status, 201);
  assert.equal(payload(bearerExchange.body.accessToken).source, "api");
  assert.equal(
    (await call("auth/session", { headers: { cookie: "kairos_session=not a token" } })).status,
    401,
  );
  // The cookie authenticates only the session exchange, not the other routes.
  assert.equal((await call("me", { method: "GET", headers: { cookie } })).status, 401);

  // CORS with credentials only for the configured Workspace origin.
  const preflight = await fetch(`${base}/api/v1/auth/session`, {
    method: "OPTIONS",
    headers: {
      origin: web,
      "access-control-request-method": "POST",
      "access-control-request-headers": "x-organization-id",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), web);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
  const foreign = await fetch(`${base}/api/v1/auth/session`, {
    method: "OPTIONS",
    headers: { origin: "https://evil.example.test", "access-control-request-method": "POST" },
  });
  assert.equal(foreign.headers.get("access-control-allow-origin"), null);
  const foreignLogin = await call("auth/login", {
    body: { email: "admin@example.test", password: "a-secure-test-password" },
    headers: { origin: "https://evil.example.test" },
  });
  assert.equal(foreignLogin.headers.get("access-control-allow-origin"), null);
  assert.equal(sessionCookie(foreignLogin.headers), undefined, "no cookie for another origin");
  assert.equal(payload(foreignLogin.body.accessToken).source, "api");

  // Logout clears the cookie and ends the session it names.
  const logout = await call("auth/logout", { headers: { cookie, origin: web } });
  assert.equal(logout.status, 200);
  const cleared = sessionCookie(logout.headers);
  assert.ok(cleared);
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/i);
  assert.match(cleared, /; Path=\/api\/v1\/auth/i);
  assert.equal((await call("auth/session", { headers: { cookie } })).status, 401);

  // --- 4. Signup creates a company and its administrator.
  client = nextClient();
  assert.equal(
    (
      await call("auth/signup", {
        body: {
          name: "Founder",
          email: "founder@example.test",
          password: "too-short",
          organizationName: "Beta",
        },
      })
    ).status,
    400,
  );
  const signup = await call("auth/signup", {
    body: {
      name: "Founder",
      email: "Founder@Example.test",
      password: "founder-pw1",
      organizationName: "Beta company",
    },
    headers: { origin: web },
  });
  assert.equal(signup.status, 201);
  assert.ok(sessionCookie(signup.headers));
  const founderClaims = payload(signup.body.accessToken);
  assert.equal(founderClaims.role, "ADMIN");
  assert.equal(founderClaims.source, "ui");
  const beta = founderClaims.organizationId;
  assert.notEqual(beta, alpha);
  const founderToken = signup.body.accessToken;
  const founderMe = await call("me", { method: "GET", token: founderToken });
  assert.equal(founderMe.status, 200);
  assert.equal(founderMe.body.email, "founder@example.test");
  assert.equal(founderMe.body.name, "Founder");
  assert.deepEqual(founderMe.body.memberships, [
    { organizationId: beta, organizationName: "Beta company", role: "ADMIN" },
  ]);

  // An existing email: a wrong password gets the generic refusal and creates nothing.
  const organizationsBefore = (await db.query("SELECT count(*)::int AS count FROM identity.organizations"))
    .rows[0].count;
  const taken = await call("auth/signup", {
    body: {
      name: "Intruder",
      email: "admin@example.test",
      password: "guessed-password",
      organizationName: "X",
    },
  });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.message, "Signup could not be completed");
  const duplicate = await call("auth/signup", {
    body: { name: "Again", email: "founder@example.test", password: "other-password", organizationName: "Y" },
  });
  assert.deepEqual(duplicate.body, taken.body);
  assert.equal(
    (await db.query("SELECT count(*)::int AS count FROM identity.organizations")).rows[0].count,
    organizationsBefore,
  );
  // The right password creates the new company for that existing account.
  const gammaSignup = await call("auth/signup", {
    body: {
      name: "Ignored",
      email: "admin@example.test",
      password: "a-secure-test-password",
      organizationName: "Gamma",
    },
  });
  assert.equal(gammaSignup.status, 201);
  const gamma = payload(gammaSignup.body.accessToken).organizationId;
  assert.equal(
    (await db.query('SELECT name FROM identity."user" WHERE email=$1', ["admin@example.test"])).rows[0].name,
    "admin",
    "an existing account keeps its profile",
  );

  // --- 5. Several memberships: login without organization asks for the choice.
  client = nextClient();
  const choice = await call("auth/login", {
    body: { email: "admin@example.test", password: "a-secure-test-password" },
    headers: { origin: web },
  });
  assert.equal(choice.status, 201);
  assert.equal(choice.body.requiresOrganization, true);
  assert.equal(choice.body.accessToken, undefined);
  assert.deepEqual(choice.body.organizations, [
    { id: alpha, name: "Alpha organization", role: "ADMIN" },
    { id: gamma, name: "Gamma", role: "ADMIN" },
  ]);
  const choiceCookie = sessionCookie(choice.headers).split(";")[0];
  assert.equal((await call("auth/session", { headers: { cookie: choiceCookie } })).status, 401);
  const chosen = await call("auth/session", {
    headers: { cookie: choiceCookie, "x-organization-id": gamma, origin: web },
  });
  assert.equal(chosen.status, 201);
  assert.equal(payload(chosen.body.accessToken).organizationId, gamma);
  assert.equal(payload(chosen.body.accessToken).source, "ui");
  const chosenByBearer = await call("auth/session", {
    token: choice.body.sessionToken,
    headers: { "x-organization-id": alpha },
  });
  assert.equal(payload(chosenByBearer.body.accessToken).organizationId, alpha);
  assert.equal(
    (await call("auth/session", { token: choice.body.sessionToken, headers: { "x-organization-id": beta } }))
      .status,
    401,
    "only organizations of the account",
  );
  const explicit = await call("auth/login", {
    body: { email: "admin@example.test", password: "a-secure-test-password", organizationId: gamma },
  });
  assert.equal(payload(explicit.body.accessToken).organizationId, gamma);
  const notMine = await call("auth/login", {
    body: { email: "admin@example.test", password: "a-secure-test-password", organizationId: beta },
  });
  assert.equal(notMine.status, 401);

  // Zero active memberships: same answer as a wrong password, and no session is left.
  const lonely = await call("auth/signup", {
    body: {
      name: "Lonely",
      email: "lonely@example.test",
      password: "lonely-pw-1",
      organizationName: "Delta",
    },
  });
  const lonelyOrganization = payload(lonely.body.accessToken).organizationId;
  await db.query("UPDATE identity.organizations SET active=false WHERE id=$1", [lonelyOrganization]);
  const lonelyId = (await db.query('SELECT id FROM identity."user" WHERE email=$1', ["lonely@example.test"]))
    .rows[0].id;
  await db.query('DELETE FROM identity.session WHERE "userId"=$1', [lonelyId]);
  const noMembership = await call("auth/login", {
    body: { email: "lonely@example.test", password: "lonely-pw-1" },
  });
  assert.equal(noMembership.status, 401);
  assert.equal(noMembership.body.message, "Invalid credentials");
  assert.equal(
    (await db.query('SELECT count(*)::int AS count FROM identity.session WHERE "userId"=$1', [lonelyId]))
      .rows[0].count,
    0,
  );

  // --- 6. Invitations.
  client = nextClient();
  const team = await call("teams", { body: { name: "Plataforma" }, token: adminToken });
  assert.equal(team.status, 201);
  const otherTeam = await call("teams", { body: { name: "Outra" }, token: gammaSignup.body.accessToken });
  assert.equal(
    (
      await call("invitations", {
        body: { email: "nova@example.test", role: "CONTRIBUTOR", teamIds: [otherTeam.body.id] },
        token: adminToken,
      })
    ).status,
    400,
    "teams of another organization are refused",
  );
  assert.equal(
    (await call("invitations", { body: { email: "admin@example.test", role: "VIEWER" }, token: adminToken }))
      .status,
    409,
    "already a member",
  );
  const invited = await call("invitations", {
    body: { email: "Nova@Example.test", role: "CONTRIBUTOR", teamIds: [team.body.id], title: "Analista" },
    token: adminToken,
  });
  assert.equal(invited.status, 201);
  const prefix = `${web}/#/convite/`;
  assert.ok(invited.body.url.startsWith(prefix));
  const token = invited.body.url.slice(prefix.length);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const expiresIn = new Date(invited.body.expiresAt).getTime() - Date.now();
  // The database clock sets the expiry; allow a small skew against the test host.
  assert.ok(Math.abs(expiresIn - 7 * 86400000) < 5 * 60000, "seven days");
  const stored = (await db.query("SELECT * FROM identity.invitations WHERE id=$1", [invited.body.id]))
    .rows[0];
  assert.equal(
    stored.token_hash,
    createHash("sha256").update(token).digest("hex"),
    "only the hash is stored",
  );
  assert.equal(stored.email, "nova@example.test");

  const preview = await call(`invitations/token/${token}`, { method: "GET" });
  assert.equal(preview.status, 200);
  assert.deepEqual(
    { ...preview.body, expiresAt: undefined },
    {
      organizationName: "Alpha organization",
      email: "nova@example.test",
      role: "CONTRIBUTOR",
      existingAccount: false,
      expiresAt: undefined,
    },
  );
  assert.equal((await call("invitations/token/not-a-token", { method: "GET" })).status, 404);
  assert.equal(
    (await call(`invitations/token/${"A".repeat(43)}`, { method: "GET" })).status,
    404,
    "unknown token",
  );
  assert.equal(
    (await call(`invitations/token/${token}/accept`, { body: { password: "short" } })).status,
    400,
    "new accounts need a password of at least ten characters",
  );
  const accepted = await call(`invitations/token/${token}/accept`, {
    body: { name: "Nova Pessoa", password: "nova-senha-1" },
    headers: { origin: web },
  });
  assert.equal(accepted.status, 201);
  assert.ok(sessionCookie(accepted.headers));
  const novaClaims = payload(accepted.body.accessToken);
  assert.equal(novaClaims.organizationId, alpha);
  assert.equal(novaClaims.role, "CONTRIBUTOR");
  assert.equal(novaClaims.source, "ui");
  assert.deepEqual(novaClaims.teamIds, [team.body.id]);
  const novaMe = await call("me", { method: "GET", token: accepted.body.accessToken });
  assert.equal(novaMe.body.title, "Analista");
  assert.equal(novaMe.body.name, "Nova Pessoa");
  // A used invitation cannot be seen or used again.
  assert.equal((await call(`invitations/token/${token}`, { method: "GET" })).status, 404);
  assert.equal(
    (await call(`invitations/token/${token}/accept`, { body: { password: "nova-senha-1" } })).status,
    404,
  );

  // An existing account joins only with its own password.
  const forFounder = await call("invitations", {
    body: { email: "founder@example.test", role: "VIEWER" },
    token: adminToken,
  });
  const founderInvite = forFounder.body.url.slice(prefix.length);
  assert.equal(
    (await call(`invitations/token/${founderInvite}`, { method: "GET" })).body.existingAccount,
    true,
  );
  const wrongPassword = await call(`invitations/token/${founderInvite}/accept`, {
    body: { password: "not-the-founder-password" },
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(
    (await call(`invitations/token/${founderInvite}`, { method: "GET" })).status,
    200,
    "still pending",
  );
  assert.equal(
    (
      await db.query("SELECT count(*)::int AS count FROM identity.members WHERE user_id=$1", [
        founderClaims.sub,
      ])
    ).rows[0].count,
    1,
  );
  const founderJoined = await call(`invitations/token/${founderInvite}/accept`, {
    body: { password: "founder-pw1" },
  });
  assert.equal(founderJoined.status, 201);
  assert.equal(payload(founderJoined.body.accessToken).organizationId, alpha);
  assert.equal(payload(founderJoined.body.accessToken).role, "VIEWER");
  const founderChoice = await call("auth/login", {
    body: { email: "founder@example.test", password: "founder-pw1" },
  });
  assert.equal(founderChoice.body.requiresOrganization, true);
  assert.equal(founderChoice.body.organizations.length, 2);

  // Revocation.
  const toRevoke = await call("invitations", {
    body: { email: "revoked@example.test", role: "VIEWER" },
    token: adminToken,
  });
  const revokedToken = toRevoke.body.url.slice(prefix.length);
  assert.equal(
    (await call(`invitations/${toRevoke.body.id}`, { method: "DELETE", token: founderToken })).status,
    404,
    "another organization's administrator",
  );
  const revoked = await call(`invitations/${toRevoke.body.id}`, { method: "DELETE", token: adminToken });
  assert.equal(revoked.status, 200);
  assert.deepEqual(revoked.body, { id: toRevoke.body.id, status: "revoked" });
  assert.equal(
    (await call(`invitations/${toRevoke.body.id}`, { method: "DELETE", token: adminToken })).status,
    200,
  );
  assert.equal((await call(`invitations/token/${revokedToken}`, { method: "GET" })).status, 404);
  assert.equal(
    (await call(`invitations/token/${revokedToken}/accept`, { body: { password: "revoked-pw-1" } })).status,
    404,
  );
  assert.equal(
    (await call(`invitations/${invited.body.id}`, { method: "DELETE", token: adminToken })).status,
    409,
  );
  assert.equal(
    (await call(`invitations/${randomUUID()}`, { method: "DELETE", token: adminToken })).status,
    404,
  );

  // Expiry.
  const toExpire = await call("invitations", {
    body: { email: "late@example.test", role: "VIEWER" },
    token: adminToken,
  });
  const lateToken = toExpire.body.url.slice(prefix.length);
  await db.query("UPDATE identity.invitations SET expires_at=now() - interval '1 minute' WHERE id=$1", [
    toExpire.body.id,
  ]);
  assert.equal((await call(`invitations/token/${lateToken}`, { method: "GET" })).status, 404);
  assert.equal(
    (await call(`invitations/token/${lateToken}/accept`, { body: { password: "late-pw-123" } })).status,
    404,
  );
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS count FROM identity."user" WHERE email=$1', [
        "late@example.test",
      ])
    ).rows[0].count,
    0,
  );

  // Listing and administrator-only management.
  const listed = await call("invitations", { method: "GET", token: adminToken });
  assert.equal(listed.status, 200);
  const statuses = Object.fromEntries(listed.body.map((row) => [row.email, row.status]));
  assert.deepEqual(statuses, {
    "nova@example.test": "accepted",
    "founder@example.test": "accepted",
    "revoked@example.test": "revoked",
    "late@example.test": "expired",
  });
  assert.ok(listed.body.every((row) => !("token_hash" in row) && !("url" in row)));
  assert.equal((await call("invitations", { method: "GET", token: accepted.body.accessToken })).status, 403);
  assert.equal(
    (
      await call("invitations", {
        body: { email: "x@example.test", role: "VIEWER" },
        token: accepted.body.accessToken,
      })
    ).status,
    403,
  );

  // Public invitation endpoints are rate limited per client.
  client = nextClient();
  let throttled = false;
  for (let i = 0; i < 25 && !throttled; i++) {
    const attempt = await call(`invitations/token/${"B".repeat(43)}`, { method: "GET" });
    if (attempt.status === 429) throttled = true;
    else assert.equal(attempt.status, 404);
  }
  assert.ok(throttled, "invitation lookups are rate limited");

  // --- 7. Directory readable by any active member.
  client = nextClient();
  await db.query(
    "UPDATE identity.teams SET description=$3, lead_user_id=$4 WHERE organization_id=$1 AND id=$2",
    [alpha, team.body.id, "Times de plataforma", novaClaims.sub],
  );
  await assert.rejects(
    db.query("UPDATE identity.teams SET lead_user_id=$3 WHERE organization_id=$1 AND id=$2", [
      alpha,
      team.body.id,
      lonelyId,
    ]),
    /teams_lead_member_fkey/,
    "the lead must be a member of the same organization",
  );
  const members = await call("organization/members", { method: "GET", token: accepted.body.accessToken });
  assert.equal(members.status, 200);
  const nova = members.body.find((member) => member.email === "nova@example.test");
  assert.deepEqual(nova, {
    id: novaClaims.sub,
    name: "Nova Pessoa",
    email: "nova@example.test",
    title: "Analista",
    role: "CONTRIBUTOR",
    active: true,
    teamIds: [team.body.id],
  });
  assert.deepEqual(members.body.map((member) => member.email).sort(), [
    "admin@example.test",
    "founder@example.test",
    "nova@example.test",
  ]);
  const teams = await call("organization/teams", { method: "GET", token: accepted.body.accessToken });
  assert.equal(teams.status, 200);
  assert.deepEqual(teams.body, [
    {
      id: team.body.id,
      name: "Plataforma",
      description: "Times de plataforma",
      leadUserId: novaClaims.sub,
      memberIds: [novaClaims.sub],
      active: true,
    },
  ]);
  assert.equal((await call("members", { method: "GET", token: accepted.body.accessToken })).status, 403);
  assert.equal((await call("organization/members", { method: "GET" })).status, 401);
  // A deactivated member loses the directory.
  await call(`members/${novaClaims.sub}`, { method: "PATCH", body: { active: false }, token: adminToken });
  assert.equal(
    (await call("organization/teams", { method: "GET", token: accepted.body.accessToken })).status,
    401,
  );

  // Existing administration keeps working.
  const adminMe = await call("me", { method: "GET", token: adminToken });
  assert.equal(adminMe.body.organizationId, alpha);
  assert.equal(adminMe.body.title, null);
  assert.deepEqual(
    adminMe.body.memberships.map((membership) => membership.organizationName),
    ["Alpha organization", "Gamma"],
  );
  assert.equal((await call("members", { method: "GET", token: adminToken })).status, 200);

  console.log(
    "Accounts integration passed: client address, organization choice, session cookie, CORS, signup, invitations and directory",
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
if (errors.length) throw new AggregateError(errors, "Accounts integration test or cleanup failed");
