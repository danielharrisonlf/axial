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
  if (!["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"].includes(role)) {
    throw new Error("Unknown role.");
  }
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const encoded = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: process.env.JWT_ISSUER ?? "http://localhost:3000/identity",
    aud: process.env.JWT_AUDIENCE ?? "axial-projects",
    sub: "11111111-1111-4111-8111-111111111111",
    organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role,
    teamIds: ["22222222-2222-4222-8222-222222222222"],
    projectIds: [],
    assignableUserIds: ["11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333"],
    assignableTeamIds: ["22222222-2222-4222-8222-222222222222"],
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
