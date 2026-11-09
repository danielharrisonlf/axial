import { readFile } from "node:fs/promises";
import { createRemoteJWKSet, importSPKI, jwtVerify } from "jose";
import { z } from "zod";

const configSchema = z
  .object({
    REALTIME_PORT: z.coerce.number().int().min(0).max(65535).default(3004),
    REALTIME_NAMESPACE: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    REDIS_URL: z
      .string()
      .url()
      .refine((value) => ["redis:", "rediss:"].includes(new URL(value).protocol)),
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    JWT_PUBLIC_KEY_PATH: z.string().min(1).optional(),
    JWT_JWKS_URL: z.string().url().optional(),
    PROJECTS_API_URL: z.string().url(),
    NODE_ENV: z.string().default("development"),
  })
  .superRefine((value, context) => {
    if (!value.JWT_PUBLIC_KEY_PATH && !value.JWT_JWKS_URL)
      context.addIssue({ code: "custom", message: "JWT key required" });
    if (value.JWT_JWKS_URL && new URL(value.JWT_JWKS_URL).protocol !== "https:")
      context.addIssue({ code: "custom", message: "JWKS requires HTTPS" });
    const url = new URL(value.PROJECTS_API_URL);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (value.NODE_ENV === "production" && url.protocol !== "https:")
    )
      context.addIssue({ code: "custom", message: "Invalid projects URL; HTTPS required in production" });
  });
export type Config = z.infer<typeof configSchema>;
export function readConfig(env: NodeJS.ProcessEnv): Config {
  return configSchema.parse(env);
}
const claims = z.object({
  sub: z.uuid(),
  organizationId: z.uuid(),
  role: z.enum(["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"]),
  exp: z.number().int(),
  iat: z.number().int(),
});
export type Identity = z.infer<typeof claims>;
export async function createVerifier(config: Config) {
  if (!config.JWT_PUBLIC_KEY_PATH && !config.JWT_JWKS_URL)
    throw new Error("JWT verification is not configured");
  const key = config.JWT_PUBLIC_KEY_PATH
    ? await importSPKI(await readFile(config.JWT_PUBLIC_KEY_PATH, "utf8"), "RS256")
    : createRemoteJWKSet(new URL(config.JWT_JWKS_URL ?? ""), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
      });
  return async (token: string): Promise<Identity> => {
    const options = {
      algorithms: ["RS256"],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      requiredClaims: ["exp", "iat", "sub"],
    };
    const result =
      typeof key === "function" ? await jwtVerify(token, key, options) : await jwtVerify(token, key, options);
    return claims.parse(result.payload);
  };
}
