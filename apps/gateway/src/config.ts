import { z } from "zod";

const serviceUrl = z
  .string()
  .url()
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "Service URLs must use http or https",
  );

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    GATEWAY_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    PROJECTS_API_URL: serviceUrl.default("http://localhost:3001"),
    IDENTITY_API_URL: serviceUrl.default("http://localhost:3002"),
    NOTIFICATIONS_API_URL: serviceUrl.default("http://localhost:3003"),
    REALTIME_API_URL: serviceUrl.default("http://localhost:3004"),
    AUDIT_API_URL: serviceUrl.default("http://localhost:3005"),
    MCP_API_URL: serviceUrl.default("http://localhost:3006"),
    // Kept as a switch only to reproduce the "before" scenario of the performance
    // analysis (one TCP connection per proxied request). Always on in production.
    GATEWAY_UPSTREAM_KEEPALIVE: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    GATEWAY_CORS_ORIGINS: z
      .string()
      .default("http://localhost:5173")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && !value.GATEWAY_UPSTREAM_KEEPALIVE)
      context.addIssue({
        code: "custom",
        path: ["GATEWAY_UPSTREAM_KEEPALIVE"],
        message: "Upstream keep-alive is required in production",
      });
    if (value.NODE_ENV !== "production") return;
    for (const name of [
      "PROJECTS_API_URL",
      "IDENTITY_API_URL",
      "NOTIFICATIONS_API_URL",
      "REALTIME_API_URL",
      "AUDIT_API_URL",
      "MCP_API_URL",
    ] as const) {
      if (new URL(value[name]).protocol !== "https:")
        context.addIssue({ code: "custom", path: [name], message: "HTTPS is required in production" });
    }
  });

export type GatewayConfig = z.infer<typeof schema>;

export function readConfig(environment: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid gateway configuration: ${fields.join(", ")}`);
  }
  return result.data;
}
