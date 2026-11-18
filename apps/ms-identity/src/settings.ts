import { z } from "zod";

/** Browser session cookie: the BetterAuth session token, sent only to the auth routes. */
export const SESSION_COOKIE = "kairos_session";
export const SESSION_COOKIE_PATH = "/api/v1/auth";
export const SESSION_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const flag = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((value) => value === "true");

const schema = z.object({
  // Reverse proxies between the client and this service. The gateway is one hop; the
  // client address is then the last X-Forwarded-For entry. 0 (or false) ignores the header.
  IDENTITY_TRUST_PROXY: z
    .string()
    .regex(/^(false|\d{1,2})$/)
    .default("0")
    .transform((value) => (value === "false" ? 0 : Number(value))),
  IDENTITY_SIGNUP_ENABLED: flag("false"),
  // Secure session cookie; false only for local HTTP development.
  IDENTITY_SESSION_COOKIE_SECURE: flag("true"),
  IDENTITY_WEB_URL: z
    .url()
    .default("http://localhost:5173")
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
    .refine((value) => !new URL(value).search && !new URL(value).hash)
    .transform((value) => value.replace(/\/+$/, "")),
  IDENTITY_TRUSTED_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type IdentitySettings = z.infer<typeof schema>;

export function readSettings(environment: NodeJS.ProcessEnv = process.env): IdentitySettings {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid identity configuration: ${fields.join(", ")}`);
  }
  return result.data;
}

/** Invitation link opened by the Workspace (hash route). */
export function invitationUrl(webUrl: string, token: string): string {
  return `${webUrl}/#/convite/${token}`;
}

/** BetterAuth session tokens are URL-safe; anything else in the cookie is ignored. */
export function sessionTokenFromCookie(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9_.-]{16,512}$/.test(value) ? value : undefined;
}
