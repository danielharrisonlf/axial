import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";

export const TEST_ISSUER = "https://identity.axial.test";
export const TEST_AUDIENCE = "axial-ms-projects-test";

export interface TestActor {
  userId?: string;
  organizationId?: string;
  role?: "ADMIN" | "PROJECT_MANAGER" | "TEAM_LEAD" | "CONTRIBUTOR" | "VIEWER";
  teamIds?: string[];
  projectIds?: string[];
  assignableUserIds?: string[];
  assignableTeamIds?: string[];
  source?: "ui" | "api" | "mcp" | "automation";
}

export interface TestAppHarness {
  app: INestApplication;
  token(
    actor?: TestActor,
    options?: { issuer?: string; audience?: string; expiresAt?: number },
  ): Promise<string>;
  close(): Promise<void>;
}

/** Refuse integration setup unless the caller explicitly points at a disposable *_test database. */
export async function startTestApp(): Promise<TestAppHarness> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl)
    throw new Error(
      "TEST_DATABASE_URL is required; integration and e2e tests never infer a writable database",
    );

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }
  const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, "").split("/")[0] ?? "");
  if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol) || !databaseName.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must use PostgreSQL and name a database ending in _test");
  }

  const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
  if (!redisUrl) throw new Error("TEST_REDIS_URL or REDIS_URL must point at the isolated test Redis service");
  const redis = new URL(redisUrl);
  if (!["redis:", "rediss:"].includes(redis.protocol))
    throw new Error("Test Redis URL must use redis:// or rediss://");

  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicPem = await exportSPKI(publicKey);
  const keyDirectory = await mkdtemp(join(tmpdir(), "axial-ms-projects-test-"));
  const keyPath = join(keyDirectory, "jwt-public.pem");
  await writeFile(keyPath, publicPem, { mode: 0o600 });

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.JWT_ISSUER = TEST_ISSUER;
  process.env.JWT_AUDIENCE = TEST_AUDIENCE;
  process.env.JWT_PUBLIC_KEY_PATH = keyPath;
  delete process.env.JWT_JWKS_URL;
  process.env.RELAY_ENABLED = "false";

  try {
    const { createApp } = await import("../../src/app.js");
    const app = await createApp();
    return {
      app,
      async token(actor = {}, options = {}) {
        return new SignJWT({
          organizationId: actor.organizationId ?? randomUUID(),
          role: actor.role ?? "ADMIN",
          teamIds: actor.teamIds ?? [],
          projectIds: actor.projectIds ?? [],
          assignableUserIds: actor.assignableUserIds ?? [],
          assignableTeamIds: actor.assignableTeamIds ?? [],
          source: actor.source ?? "api",
        })
          .setProtectedHeader({ alg: "RS256", typ: "JWT" })
          .setIssuer(options.issuer ?? TEST_ISSUER)
          .setAudience(options.audience ?? TEST_AUDIENCE)
          .setSubject(actor.userId ?? randomUUID())
          .setIssuedAt()
          .setExpirationTime(options.expiresAt ?? "5m")
          .sign(privateKey);
      },
      async close() {
        await app.close();
        await rm(keyDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(keyDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function uuid(): string {
  return randomUUID();
}
