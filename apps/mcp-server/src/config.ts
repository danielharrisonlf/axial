import { z } from "zod";

/** Base URLs may carry a path prefix (useful behind a proxy); `/api/v1` is appended per request. */
const httpUrl = z
  .string()
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "URL must use http or https")
  .transform((value) => value.replace(/\/+$/, ""));

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    MCP_PORT: z.coerce.number().int().min(1).max(65_535).default(3006),
    MCP_RESOURCE: httpUrl.default("http://localhost:3006/mcp"),
    MCP_PUBLIC_KEY_PATH: z.string().min(1).optional(),
    MCP_JWKS_URL: z.url().optional(),
    MCP_JWT_ISSUER: z.string().min(1),
    MCP_JWT_AUDIENCE: z.string().min(1),
    PROJECTS_API_URL: httpUrl.default("http://localhost:3001"),
    AUDIT_API_URL: httpUrl.default("http://localhost:3005"),
    NOTIFICATIONS_API_URL: httpUrl.default("http://localhost:3003"),
    IDENTITY_API_URL: httpUrl.default("http://localhost:3002"),
    MCP_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    /** stdio only: a signed access token, verified exactly like an HTTP bearer token. */
    MCP_ACCESS_TOKEN: z.string().min(1).optional(),
    /** stdio only: a file holding the access token, re-read on every call so it can be refreshed. */
    MCP_ACCESS_TOKEN_FILE: z.string().min(1).optional(),
    /** Host header names accepted by the MCP endpoint (DNS-rebinding protection); add the public host. */
    MCP_ALLOWED_HOSTS: z
      .string()
      .default("localhost,127.0.0.1,[::1]")
      .transform((value) =>
        value
          .split(",")
          .map((host) => host.trim())
          .filter(Boolean),
      ),
    MCP_ALLOWED_ORIGINS: z
      .string()
      .default("http://localhost:5173,http://localhost:4173")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
  })
  .superRefine((value, context) => {
    if (!value.MCP_PUBLIC_KEY_PATH && !value.MCP_JWKS_URL)
      context.addIssue({
        code: "custom",
        path: ["MCP_PUBLIC_KEY_PATH"],
        message: "A public key or JWKS URL is required",
      });
    if (value.MCP_JWKS_URL && new URL(value.MCP_JWKS_URL).protocol !== "https:")
      context.addIssue({ code: "custom", path: ["MCP_JWKS_URL"], message: "JWKS requires HTTPS" });
    if (value.NODE_ENV === "production") {
      for (const name of [
        "MCP_RESOURCE",
        "PROJECTS_API_URL",
        "AUDIT_API_URL",
        "NOTIFICATIONS_API_URL",
        "IDENTITY_API_URL",
      ] as const) {
        if (new URL(value[name]).protocol !== "https:")
          context.addIssue({ code: "custom", path: [name], message: "HTTPS is required in production" });
      }
    }
  });

export type McpConfig = z.infer<typeof schema>;

export function readConfig(environment: NodeJS.ProcessEnv = process.env): McpConfig {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid MCP configuration: ${fields.join(", ")}`);
  }
  return result.data;
}
