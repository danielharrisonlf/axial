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
const databaseName = `axial_identity_${randomUUID().replaceAll("-", "")}_test`;
const testUrl = new URL(url);
testUrl.pathname = `/${databaseName}`;
const db = new pg.Pool({ connectionString: testUrl.toString() });
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
  IDENTITY_DATABASE_URL: testUrl.toString(),
  IDENTITY_PRIVATE_KEY_PATH: join(dir, "private.pem"),
  IDENTITY_PUBLIC_KEY_PATH: join(dir, "public.pem"),
  IDENTITY_PORT: "3202",
  IDENTITY_BOOTSTRAP_EMAIL: "admin@example.test",
  IDENTITY_BOOTSTRAP_PASSWORD: "a-secure-test-password",
  IDENTITY_BOOTSTRAP_ORGANIZATION: "Test organization",
};
let server;
let created = false;
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  for (const file of ["src/migrate.ts", "src/bootstrap.ts"]) {
    const run = spawnSync(process.execPath, ["--import", "tsx", file], { env, encoding: "utf8" });
    if (run.status !== 0) throw new Error(run.stderr);
  }
  const organization = (await db.query("SELECT id FROM identity.organizations LIMIT 1")).rows[0].id;
  server = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], { env, stdio: "inherit" });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:3202/api/v1/health/ready")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "server failed to start");
  async function request(path, body, token, method = "POST") {
    const r = await fetch(`http://127.0.0.1:3202/api/v1/${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  }
  const login = await request("auth/login", {
    email: "admin@example.test",
    password: "a-secure-test-password",
    organizationId: organization,
  });
  assert.equal(login.status, 201);
  assert.equal(login.body.expiresIn, 300);
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
  const publicVerifier = await importSPKI(publicKey, "RS256");
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
  assert.equal(
    (
      await request(
        "auth/password",
        { currentPassword: "second-private-password", newPassword: "a-third-secure-password" },
        temporary.body.accessToken,
      )
    ).status,
    401,
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
  const denied = await request("members", null, second.body.accessToken, "GET");
  assert.equal(denied.status, 403);
  const invalid = await request("auth/login", {
    email: "admin@example.test",
    password: "incorrect",
    organizationId: organization,
  });
  assert.equal(invalid.status, 401);
  const passwordChange = await request(
    "auth/password",
    { currentPassword: "a-secure-test-password", newPassword: "a-new-secure-password" },
    login.body.accessToken,
  );
  assert.equal(passwordChange.status, 201);
  assert.equal(
    (
      await request("auth/login", {
        email: "admin@example.test",
        password: "a-secure-test-password",
        organizationId: organization,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("auth/login", {
        email: "admin@example.test",
        password: "a-new-secure-password",
        organizationId: organization,
      })
    ).status,
    201,
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal(
      (
        await request(
          "auth/password",
          { currentPassword: "incorrect", newPassword: "another-private-password" },
          login.body.accessToken,
        )
      ).status,
      401,
    );
  }
  assert.equal(
    (
      await request(
        "auth/password",
        { currentPassword: "a-new-secure-password", newPassword: "another-private-password" },
        login.body.accessToken,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request("auth/login", {
        email: "admin@example.test",
        password: "a-new-secure-password",
        organizationId: organization,
      })
    ).status,
    401,
  );
  await db.query(
    "UPDATE identity.users SET failed_attempts=0,locked_until=NULL WHERE email='admin@example.test'",
  );
  const newOrg = await request(
    "organizations",
    { name: "Concurrent administration" },
    login.body.accessToken,
  );
  assert.equal(newOrg.status, 201);
  const orgId = newOrg.body.id;
  const firstAdmin = await request("auth/login", {
    email: "admin@example.test",
    password: "a-new-secure-password",
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
  const firstId = (await db.query("SELECT id FROM identity.users WHERE email='admin@example.test'")).rows[0]
    .id;
  const simultaneous = await Promise.all([
    request(`members/${third.body.id}`, { role: "VIEWER" }, firstAdmin.body.accessToken, "PATCH"),
    request(`members/${firstId}`, { role: "VIEWER" }, thirdAdmin.body.accessToken, "PATCH"),
  ]);
  assert.deepEqual(simultaneous.map((result) => result.status).sort(), [200, 403]);
  const adminCount = await db.query(
    "SELECT count(*) FROM identity.members m JOIN identity.users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.role='ADMIN' AND m.active AND u.active AND NOT u.must_change_password",
    [orgId],
  );
  assert.equal(Number(adminCount.rows[0].count), 1);
  await db.query(
    "INSERT INTO identity.users(id,email,password_hash) SELECT gen_random_uuid(), 'load-' || n || '@example.test', 'unused' FROM generate_series(1,150) AS n",
  );
  await db.query(
    "INSERT INTO identity.members(organization_id,user_id,role) SELECT $1,id,'VIEWER' FROM identity.users WHERE email LIKE 'load-%@example.test'",
    [organization],
  );
  const oversized = await request("auth/login", {
    email: "admin@example.test",
    password: "a-new-secure-password",
    organizationId: organization,
  });
  assert.equal(oversized.status, 422);
  const wrongPassword = () =>
    request(
      "auth/password",
      { currentPassword: "incorrect", newPassword: "another-private-password" },
      login.body.accessToken,
    );
  const concurrentPasswords = await Promise.all(Array.from({ length: 4 }, wrongPassword));
  assert.deepEqual(
    concurrentPasswords.map((result) => result.status),
    [401, 401, 401, 401],
  );
  assert.equal((await wrongPassword()).status, 401);
  const lockedAccount = (
    await db.query("SELECT failed_attempts,locked_until FROM identity.users WHERE email='admin@example.test'")
  ).rows[0];
  assert.equal(lockedAccount.failed_attempts, 5);
  assert.ok(lockedAccount.locked_until > new Date());
  assert.equal((await wrongPassword()).status, 401);
  const lockedConcurrent = await Promise.all([wrongPassword(), wrongPassword()]);
  assert.deepEqual(
    lockedConcurrent.map((result) => result.status),
    [401, 401],
  );
  assert.equal(
    Number(
      (await db.query("SELECT failed_attempts FROM identity.users WHERE email='admin@example.test'")).rows[0]
        .failed_attempts,
    ),
    5,
  );
  const flood = await Promise.all(Array.from({ length: 25 }, wrongPassword));
  assert.ok(flood.some((result) => result.status === 429));
  assert.equal((await wrongPassword()).status, 429);
  assert.equal((await request("health/ready", null, null, "GET")).status, 200);
  assert.ok(Number((await db.query("SELECT count(*) FROM identity.outbox_events")).rows[0].count) >= 4);
  console.log("Integration passed: migration, bootstrap, login, role revocation and outbox");
} finally {
  if (server) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  await db.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
  rmSync(dir, { recursive: true, force: true });
}
