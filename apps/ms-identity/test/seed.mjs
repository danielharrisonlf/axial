// Run from apps/ms-identity: IDENTITY_TEST_DATABASE_URL must name a *_test database whose
// user has CREATEDB. A disposable database is created and dropped for this run. Seeds the demo
// directory twice, then logs in as seeded people and compares the access-token claims with
// claimsFor from @axial/demo-fixtures (compile it first: pnpm --filter "@axial/demo-fixtures..." build).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ATLAS_ORGANIZATION_ID,
  claimsFor,
  demoUser,
  memberships,
  projectAssignments,
  teamMemberships,
  teams,
  users,
  VETOR_ORGANIZATION_ID,
} from "@axial/demo-fixtures";
import pg from "pg";

const url = process.env.IDENTITY_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("IDENTITY_TEST_DATABASE_URL must name a _test database");
const admin = new pg.Pool({ connectionString: url });
const poolErrors = [];
admin.on("error", (error) => poolErrors.push(error));
const databaseName = `axial_identity_seed_${randomUUID().replaceAll("-", "")}_test`;
const testUrl = new URL(url);
testUrl.pathname = `/${databaseName}`;
const db = new pg.Pool({ connectionString: testUrl.toString() });
db.on("error", (error) => poolErrors.push(error));
const dir = mkdtempSync(join(tmpdir(), "identity-seed-test-"));
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
writeFileSync(join(dir, "private.pem"), privateKey);
writeFileSync(join(dir, "public.pem"), publicKey);
const port = 3205;
const base = `http://127.0.0.1:${port}`;
// Development fixture of this test only: the seed takes the password from the environment.
const demoPassword = `demo-${randomUUID()}`;
const env = {
  ...process.env,
  NODE_ENV: "test",
  IDENTITY_DATABASE_URL: testUrl.toString(),
  IDENTITY_TEST_DATABASE_URL: testUrl.toString(),
  IDENTITY_PRIVATE_KEY_PATH: join(dir, "private.pem"),
  IDENTITY_PUBLIC_KEY_PATH: join(dir, "public.pem"),
  IDENTITY_ISSUER: "http://localhost:3000/identity",
  IDENTITY_AUDIENCE: "axial-projects",
  IDENTITY_OAUTH_RESOURCE: "http://localhost:3000/mcp",
  BETTER_AUTH_SECRET: "integration-secret-with-at-least-32-chars",
  BETTER_AUTH_URL: base,
  IDENTITY_PORT: String(port),
  AXIAL_DEMO_PASSWORD: demoPassword,
};
let server;
let serverClosed;
let created = false;
let failure;
const cleanupErrors = [];

const tsx = (args, extra = {}) =>
  spawnSync(process.execPath, ["--import", "tsx", ...args], { env: { ...env, ...extra }, encoding: "utf8" });
const run = (args) => {
  const result = tsx(args);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};
const report = (stdout) => JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1));

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

async function login(body) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Access-token claims in the shape of claimsFor. */
function claimsOf(jwt) {
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  return {
    userId: payload.sub,
    organizationId: payload.organizationId,
    role: payload.role,
    teamIds: payload.teamIds,
    projectIds: payload.projectIds,
    assignableUserIds: payload.assignableUserIds,
    assignableTeamIds: payload.assignableTeamIds,
  };
}

try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  run(["src/migrate.ts"]);

  // The development entry point refuses a *_test database; the seed refuses a missing or short password.
  const refused = tsx(["src/seed-demo.ts"]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /\*_dev database/);
  for (const AXIAL_DEMO_PASSWORD of ["", "nine-char"]) {
    const weak = tsx(["src/seed-demo.ts", "--test"], { AXIAL_DEMO_PASSWORD });
    assert.notEqual(weak.status, 0);
    assert.match(weak.stderr, /AXIAL_DEMO_PASSWORD is required/);
  }
  const production = tsx(["src/seed-demo.ts", "--test"], { NODE_ENV: "production" });
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /cannot run in production/);

  const counts = {
    organizations: 2,
    users: users.length,
    accounts: users.length,
    members: memberships.length,
    teams: teams.length,
    teamMembers: teamMemberships.length,
    projectAssignments: projectAssignments.length,
  };
  const first = report(run(["src/seed-demo.ts", "--test"]));
  assert.deepEqual(first.inserted, counts);
  assert.deepEqual(first.present, counts);
  const hashes = await db.query(`SELECT password FROM identity.account ORDER BY "userId"`);
  const outbox = Number((await db.query("SELECT count(*) FROM identity.outbox_events")).rows[0].count);
  const second = report(run(["src/seed-demo.ts", "--test"]));
  assert.deepEqual(second.inserted, {
    organizations: 0,
    users: 0,
    accounts: 0,
    members: 0,
    teams: 0,
    teamMembers: 0,
    projectAssignments: 0,
  });
  assert.deepEqual(second.present, counts);
  // nothing rewritten: same password hashes, no new outbox events
  assert.deepEqual(
    (await db.query(`SELECT password FROM identity.account ORDER BY "userId"`)).rows,
    hashes.rows,
  );
  assert.equal(Number((await db.query("SELECT count(*) FROM identity.outbox_events")).rows[0].count), outbox);

  const helena = demoUser("helena.costa@vetorlabs.dev");
  const ricardo = demoUser("ricardo.nogueira@vetorlabs.dev");
  const profile = await db.query(
    `SELECT u.name, u."emailVerified", u."mustChangePassword", m.title, m.role, m.active
       FROM identity."user" u JOIN identity.members m ON m.user_id=u.id
      WHERE u.id=$1 AND m.organization_id=$2`,
    [ricardo.id, VETOR_ORGANIZATION_ID],
  );
  assert.deepEqual(profile.rows[0], {
    name: ricardo.name,
    emailVerified: true,
    mustChangePassword: false,
    title: ricardo.title,
    role: "PROJECT_MANAGER",
    active: true,
  });
  const plataforma = teams.find((item) => item.legacyId === "tm-plat");
  assert.ok(plataforma);
  const team = await db.query("SELECT name, description, lead_user_id FROM identity.teams WHERE id=$1", [
    plataforma.id,
  ]);
  assert.deepEqual(team.rows[0], {
    name: plataforma.name,
    description: plataforma.description,
    lead_user_id: plataforma.leadId,
  });

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

  // Helena is ADMIN in Vetor Labs and Atlas: the login asks for the organization.
  const choice = await login({ email: helena.email, password: demoPassword });
  assert.equal(choice.status, 201);
  assert.equal(choice.body.requiresOrganization, true);
  assert.equal(choice.body.accessToken, undefined);
  assert.deepEqual(
    [...choice.body.organizations].sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: ATLAS_ORGANIZATION_ID, name: "Atlas Engenharia & Consultoria", role: "ADMIN" },
      { id: VETOR_ORGANIZATION_ID, name: "Vetor Labs", role: "ADMIN" },
    ].sort((a, b) => a.id.localeCompare(b.id)),
  );
  for (const organizationId of [VETOR_ORGANIZATION_ID, ATLAS_ORGANIZATION_ID]) {
    const chosen = await login({ email: helena.email, password: demoPassword, organizationId });
    assert.equal(chosen.status, 201);
    assert.equal(chosen.body.requiresPasswordChange, false);
    assert.deepEqual(claimsOf(chosen.body.accessToken), claimsFor(helena.id, organizationId));
  }

  // Ricardo belongs to one organization: tokens right away.
  const single = await login({ email: ricardo.email, password: demoPassword });
  assert.equal(single.status, 201);
  assert.equal(single.body.requiresPasswordChange, false);
  assert.ok(single.body.accessToken);
  assert.deepEqual(claimsOf(single.body.accessToken), claimsFor(ricardo.id));
  assert.ok(claimsFor(ricardo.id).projectIds.length > 0);

  assert.equal((await login({ email: ricardo.email, password: "wrong-password" })).status, 401);
  console.log(
    `Identity demo seed: ${users.length} accounts, ${memberships.length} memberships, idempotent on repeat; logins match claimsFor`,
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
if (errors.length) throw new AggregateError(errors, "Identity seed integration test or cleanup failed");
