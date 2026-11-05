import { z } from "zod";

const booleanEnv = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

export const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    DATABASE_URL: z
      .url()
      .refine(
        (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
        "Use postgres:// or postgresql://",
      ),
    REDIS_URL: z
      .url()
      .refine(
        (value) => ["redis:", "rediss:"].includes(new URL(value).protocol),
        "Use redis:// or rediss://",
      ),
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    JWT_PUBLIC_KEY_PATH: z.string().min(1).optional(),
    JWT_JWKS_URL: z.url().optional(),
    RELAY_ENABLED: booleanEnv,
    RELAY_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),
    CORS_ORIGINS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
  })
  .superRefine((value, context) => {
    if (!value.JWT_PUBLIC_KEY_PATH && !value.JWT_JWKS_URL) {
      context.addIssue({
        code: "custom",
        path: ["JWT_PUBLIC_KEY_PATH"],
        message: "A JWT public key or JWKS URL is required",
      });
    }
    if (value.JWT_JWKS_URL && new URL(value.JWT_JWKS_URL).protocol !== "https:") {
      context.addIssue({ code: "custom", path: ["JWT_JWKS_URL"], message: "JWKS requires HTTPS" });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;
export const CONFIG = Symbol("APP_CONFIG");

export function readConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(environment);
  if (!result.success) {
    // Report only field names: connection strings and authentication material must never be logged.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid service configuration: ${fields.join(", ")}`);
  }
  return result.data;
}
