import { z } from "zod";

const httpUrl = z
  .string()
  .url()
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "URL must use http or https",
  );

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
      for (const name of ["MCP_RESOURCE", "PROJECTS_API_URL"] as const) {
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
