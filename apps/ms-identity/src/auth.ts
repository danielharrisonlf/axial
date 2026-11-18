import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import type { Pool } from "pg";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./common.js";

export const BETTER_AUTH_BASE_PATH = "/api/v1/session";

/**
 * BetterAuth is the only credential and session authority. Authorization claims
 * (organization, role, teams, projects) remain in the identity domain tables and
 * are snapshotted into the short-lived RS256 access token issued by this service.
 */
export function createAuth(database: Pool) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must have at least 32 characters");
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const trustedOrigins = (process.env.IDENTITY_TRUSTED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return betterAuth({
    appName: "Kairos",
    baseURL,
    basePath: BETTER_AUTH_BASE_PATH,
    secret,
    database,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        mustChangePassword: {
          type: "boolean",
          required: false,
          defaultValue: false,
          // Server-owned: only the identity service changes this flag.
          input: false,
        },
      },
    },
    advanced: {
      database: {
        // The migration declares UUID columns; generate valid UUIDs for every model.
        generateId: "uuid",
      },
    },
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      disabled: process.env.NODE_ENV === "test",
    },
    plugins: [bearer()],
  });
}

export type IdentityAuth = ReturnType<typeof createAuth>;
