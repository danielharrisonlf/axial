import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../keys/", import.meta.url));
const privatePath = `${directory}/dev-private.pem`;
const publicPath = `${directory}/dev-public.pem`;
const command = process.argv[2];

if (command === "init") {
  if (existsSync(privatePath) || existsSync(publicPath)) {
    if (!existsSync(privatePath) || !existsSync(publicPath)) {
      throw new Error("Incomplete local key pair: restore both files before continuing.");
    }
    console.log("Existing development keys preserved.");
  } else {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    await mkdir(directory, { recursive: true });
    await writeFile(privatePath, pair.privateKey, { mode: 0o600, flag: "wx" });
    await writeFile(publicPath, pair.publicKey, { flag: "wx" });
    console.log("Local development keys created in ignored keys/ directory.");
  }
} else if (command === "token") {
  const role = process.argv[3] ?? "ADMIN";
  // each role signs as a seeded person of the fictional Vetor Labs scenario (pnpm db:seed:demo)
  const people = {
    ADMIN: "helena.costa@vetorlabs.dev",
    PROJECT_MANAGER: "ricardo.nogueira@vetorlabs.dev",
    TEAM_LEAD: "ana.souza@vetorlabs.dev",
    CONTRIBUTOR: "camila.freitas@vetorlabs.dev",
    VIEWER: "sergio.tavares@vetorlabs.dev",
  };
  const email = Object.hasOwn(people, role) ? people[role] : undefined;
  if (!email) throw new Error("Unknown role.");
  const fixtures = new URL("../packages/demo-fixtures/dist/index.js", import.meta.url);
  if (!existsSync(fixtures))
    throw new Error('Demo fixtures are not built: run "pnpm --filter @axial/demo-fixtures... build" first.');
  const { claimsFor, demoUser } = await import(fixtures.href);
  const claims = claimsFor(demoUser(email).id);
  if (claims.role !== role) throw new Error(`Seeded user ${email} is ${claims.role}, not ${role}.`);
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const encoded = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: process.env.JWT_ISSUER ?? "http://localhost:3000/identity",
    aud: process.env.JWT_AUDIENCE ?? "axial-projects",
    sub: claims.userId,
    organizationId: claims.organizationId,
    role,
    teamIds: claims.teamIds,
    projectIds: claims.projectIds,
    assignableUserIds: claims.assignableUserIds,
    assignableTeamIds: claims.assignableTeamIds,
    source: "api",
    jti: randomUUID(),
    iat: now,
    exp: now + 900,
  })}`;
  const signature = sign("RSA-SHA256", Buffer.from(encoded), await readFile(privatePath)).toString(
    "base64url",
  );
  console.log(`${encoded}.${signature}`);
} else {
  throw new Error("Usage: node scripts/dev-identity.mjs init|token [ROLE]");
}
