import { describe, expect, it } from "vitest";
import { readConfig } from "../../src/config.js";
import { eventSchema, messageSchema } from "../../src/protocol.js";

const base = {
  REDIS_URL: "redis://localhost:6379/0",
  REALTIME_NAMESPACE: "test_realtime",
  JWT_ISSUER: "issuer",
  JWT_AUDIENCE: "audience",
  JWT_PUBLIC_KEY_PATH: "public.pem",
  PROJECTS_API_URL: "http://localhost:3001/api/v1",
};

describe("configuration", () => {
  it("uses a service-specific port and requires isolated pubsub namespace", () => {
    expect(readConfig({ ...base, PORT: "3001", REALTIME_PORT: "3004" }).REALTIME_PORT).toBe(3004);
    expect(() => readConfig({ ...base, REALTIME_NAMESPACE: "bad:namespace" })).toThrow();
    expect(() => readConfig({ ...base, REALTIME_NAMESPACE: undefined })).toThrow();
  });
  it("requires a verification key and HTTPS for production projects API and JWKS", () => {
    expect(() => readConfig({ ...base, JWT_PUBLIC_KEY_PATH: undefined })).toThrow();
    expect(() => readConfig({ ...base, JWT_JWKS_URL: "http://localhost/keys" })).toThrow();
    expect(() => readConfig({ ...base, NODE_ENV: "production" })).toThrow();
    expect(
      readConfig({ ...base, NODE_ENV: "production", PROJECTS_API_URL: "https://projects.example/api/v1" })
        .NODE_ENV,
    ).toBe("production");
  });
});

describe("protocol", () => {
  it("rejects malformed requests and additional fields", () => {
    expect(messageSchema.safeParse({ type: "subscribe", projectId: "not-a-uuid" }).success).toBe(false);
    expect(
      messageSchema.safeParse({ type: "authenticate", token: "token", organizationId: "untrusted" }).success,
    ).toBe(false);
  });
  it("strips private fields from domain events and rejects missing project scope", () => {
    const event = {
      id: "7a07bf69-f80a-4a3e-8e1f-22db33a3746d",
      type: "task.updated",
      version: 1,
      occurredAt: "2026-11-09T00:00:00.000Z",
      organizationId: "7a07bf69-f80a-4a3e-8e1f-22db33a3746d",
      projectId: "e0781765-34d8-45df-8a21-f3cfb3a1f13a",
      aggregate: { type: "task", id: "e0781765-34d8-45df-8a21-f3cfb3a1f13a", version: 1 },
      data: { before: "secret" },
    };
    expect(eventSchema.parse(event)).not.toHaveProperty("data");
    expect(eventSchema.safeParse({ ...event, projectId: null }).success).toBe(false);
  });
});
