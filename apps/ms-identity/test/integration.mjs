import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
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
const databaseName = `axial_identity_${randomUUID().replaceAll("-", "")}_test`;
const testUrl = new URL(url);
testUrl.pathname = `/${databaseName}`;
const db = new pg.Pool({ connectionString: testUrl.toString() });
db.on("error", (error) => poolErrors.push(error));
const dir = mkdtempSync(join(tmpdir(), "identity-test-"));
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
writeFileSync(join(dir, "private.pem"), privateKey);
writeFileSync(join(dir, "public.pem"), publicKey);
const env = {
  ...process.env,
  NODE_ENV: "test",
  IDENTITY_DATABASE_URL: testUrl.toString(),
  IDENTITY_PRIVATE_KEY_PATH: join(dir, "private.pem"),
  IDENTITY_PUBLIC_KEY_PATH: join(dir, "public.pem"),
  IDENTITY_ISSUER: "http://localhost:3000/identity",
  IDENTITY_AUDIENCE: "axial-projects",
  BETTER_AUTH_SECRET: "integration-secret-with-at-least-32-chars",
  BETTER_AUTH_URL: "http://localhost:3202",
  IDENTITY_TRUSTED_ORIGINS: "http://localhost:5173",
  IDENTITY_PORT: "3202",
  IDENTITY_BOOTSTRAP_EMAIL: "admin@example.test",
  IDENTITY_BOOTSTRAP_PASSWORD: "a-secure-test-password",
  IDENTITY_BOOTSTRAP_ORGANIZATION: "Test organization",
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
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  for (const file of ["src/migrate.ts", "src/bootstrap.ts"]) {
    const run = spawnSync(process.execPath, ["--import", "tsx", file], { env, encoding: "utf8" });
    if (run.status !== 0) throw new Error(run.stderr || run.stdout);
  }
  const organization = (await db.query("SELECT id FROM identity.organizations LIMIT 1")).rows[0].id;
  server = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], { env, stdio: "inherit" });
  serverClosed = new Promise((resolve) => {
    server.once("error", (error) => {
      poolErrors.push(error);
      resolve();
    });
    server.once("close", resolve);
  });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch("http://127.0.0.1:3202/api/v1/health/ready")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "server failed to start");

  async function request(path, body, token, method = "POST") {
    const response = await fetch(`http://127.0.0.1:3202/api/v1/${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }

  for (const migration of ["001_initial", "002_password_activation", "003_betterauth"]) {
    await db.query("DELETE FROM identity.schema_migrations WHERE id=$1", [migration]);
    assert.equal((await request("health/ready", null, null, "GET")).status, 503);
    assert.equal((await request("health/live", null, null, "GET")).status, 200);
    await db.query("INSERT INTO identity.schema_migrations(id) VALUES ($1)", [migration]);
    assert.equal((await request("health/ready", null, null, "GET")).status, 200);
  }

  const login = await request("auth/login", {
    email: "admin@example.test",
    password: "a-secure-test-password",
    organizationId: organization,
  });
  assert.equal(login.status, 201);
  assert.equal(login.body.expiresIn, 300);
  assert.equal(login.body.requiresPasswordChange, false);
  assert.ok(login.body.sessionToken);

  const publicVerifier = await importSPKI(publicKey, "RS256");
  await jwtVerify(login.body.accessToken, publicVerifier, {
    algorithms: ["RS256"],
    issuer: "http://localhost:3000/identity",
    audience: "axial-projects",
  });
  const exchanged = await request("auth/session", null, login.body.sessionToken);
  assert.equal(exchanged.status, 201);
  assert.ok(exchanged.body.accessToken);

  const member = await request(
    "members",
    { email: "second@example.test", password: "another-secure-password", role: "ADMIN" },
    login.body.accessToken,
  );
  assert.equal(member.status, 201);
  const temporary = await request("auth/login", {
    email: "second@example.test",
    password: "another-secure-password",
    organizationId: organization,
  });
  assert.equal(temporary.status, 201);
  assert.equal(temporary.body.requiresPasswordChange, true);
  await assert.rejects(
    jwtVerify(temporary.body.accessToken, publicVerifier, {
      algorithms: ["RS256"],
      issuer: "http://localhost:3000/identity",
      audience: "axial-projects",
    }),
  );
  assert.equal((await request("members", null, temporary.body.accessToken, "GET")).status, 401);
  assert.equal(
    (
      await request(
        "auth/password",
        { currentPassword: "another-secure-password", newPassword: "another-secure-password" },
        temporary.body.accessToken,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "auth/password",
        { currentPassword: "wrong", newPassword: "second-private-password" },
        temporary.body.accessToken,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "auth/password",
        { currentPassword: "another-secure-password", newPassword: "second-private-password" },
        temporary.body.accessToken,
      )
    ).status,
    201,
  );
  const second = await request("auth/login", {
    email: "second@example.test",
    password: "second-private-password",
    organizationId: organization,
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.requiresPasswordChange, false);

  const changed = await request(
    `members/${member.body.id}`,
    { role: "VIEWER" },
    login.body.accessToken,
    "PATCH",
  );
  assert.equal(changed.status, 200);
  assert.equal((await request("members", null, second.body.accessToken, "GET")).status, 403);

  const reset = await request(
    `members/${member.body.id}/password`,
    { newPassword: "reset-private-password" },
    login.body.accessToken,
  );
  assert.equal(reset.status, 201);
  assert.equal(
    (
      await request("auth/login", {
        email: "second@example.test",
        password: "second-private-password",
        organizationId: organization,
      })
    ).status,
    401,
  );
  const resetLogin = await request("auth/login", {
    email: "second@example.test",
    password: "reset-private-password",
    organizationId: organization,
  });
  assert.equal(resetLogin.status, 201);
  assert.equal(resetLogin.body.requiresPasswordChange, true);

  const invalid = await request("auth/login", {
    email: "admin@example.test",
    password: "incorrect",
    organizationId: organization,
  });
  assert.equal(invalid.status, 401);

  const newOrg = await request(
    "organizations",
    { name: "Concurrent administration" },
    login.body.accessToken,
  );
  assert.equal(newOrg.status, 201);
  const orgId = newOrg.body.id;
  const firstAdmin = await request("auth/login", {
    email: "admin@example.test",
    password: "a-secure-test-password",
    organizationId: orgId,
  });
  const third = await request(
    "members",
    { email: "third@example.test", password: "third-temporary-password", role: "ADMIN" },
    firstAdmin.body.accessToken,
  );
  const thirdTemp = await request("auth/login", {
    email: "third@example.test",
    password: "third-temporary-password",
    organizationId: orgId,
  });
  assert.equal(
    (
      await request(
        "auth/password",
        { currentPassword: "third-temporary-password", newPassword: "third-private-password" },
        thirdTemp.body.accessToken,
      )
    ).status,
    201,
  );
  const thirdAdmin = await request("auth/login", {
    email: "third@example.test",
    password: "third-private-password",
    organizationId: orgId,
  });
  const firstId = (
    await db.query('SELECT id FROM identity."user" WHERE email=$1', ["admin@example.test"])
  ).rows[0].id;
  const simultaneous = await Promise.all([
    request(`members/${third.body.id}`, { role: "VIEWER" }, firstAdmin.body.accessToken, "PATCH"),
    request(`members/${firstId}`, { role: "VIEWER" }, thirdAdmin.body.accessToken, "PATCH"),
  ]);
  assert.deepEqual(simultaneous.map((result) => result.status).sort(), [200, 403]);
  const adminCount = await db.query(
    'SELECT count(*) FROM identity.members m JOIN identity."user" u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.role=\'ADMIN\' AND m.active AND NOT u."mustChangePassword"',
    [orgId],
  );
  assert.equal(Number(adminCount.rows[0].count), 1);

  await db.query(
    'INSERT INTO identity."user"(id,email,name) SELECT gen_random_uuid(), \'load-\' || n || \'@example.test\', \'Load\' FROM generate_series(1,150) AS n',
  );
  await db.query(
    'INSERT INTO identity.members(organization_id,user_id,role) SELECT $1,id,\'VIEWER\' FROM identity."user" WHERE email LIKE \'load-%@example.test\'',
    [organization],
  );
  const oversized = await request("auth/login", {
    email: "admin@example.test",
    password: "a-secure-test-password",
    organizationId: organization,
  });
  assert.equal(oversized.status, 422);

  assert.equal((await request("auth/logout", null, login.body.sessionToken)).status, 200);
  assert.equal((await request("health/ready", null, null, "GET")).status, 200);
  assert.ok(Number((await db.query("SELECT count(*) FROM identity.outbox_events")).rows[0].count) >= 4);
  assert.ok(Number((await db.query("SELECT count(*) FROM identity.account")).rows[0].count) >= 3);
  console.log(
    "Integration passed: migration, bootstrap, BetterAuth login/session, password lifecycle, admin concurrency and outbox",
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
if (errors.length) throw new AggregateError(errors, "Integration test or cleanup failed");
