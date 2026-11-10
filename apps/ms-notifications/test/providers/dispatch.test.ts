import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../src/db.js", () => ({ db: { query: mocks.query, connect: mocks.connect } }));

import { configuredProvider, dispatchOne } from "../../src/consumer.js";

const envKeys = [
  "NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION",
  "NOTIFICATIONS_PROVIDER_URL",
  "NOTIFICATIONS_PROVIDER_TOKEN",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "SMSGO_API_KEY",
  "SMSGO_SMS_TYPE_ID",
  "META_ACCESS_TOKEN",
  "META_PHONE_NUMBER_ID",
  "META_TEMPLATE_NAME",
  "META_LANGUAGE_CODE",
  "META_GRAPH_VERSION",
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("configured provider dispatch", () => {
  it.each([
    ["email", "person@example.com", "https://api.resend.com/emails", "email-id"],
    ["sms", "+5511999990000", "https://api.smsgo.com.br/v1/sms/send/single", "sms-id"],
    ["whatsapp", "5511999990000", "https://graph.facebook.com/v22.0/12345/messages", "whatsapp-id"],
  ])(
    "routes %s through its configured adapter and records acceptance",
    async (channel, destination, endpoint, providerId) => {
      for (const key of envKeys) vi.stubEnv(key, "");
      vi.stubEnv("NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION", "true");
      vi.stubEnv("RESEND_API_KEY", "test-key");
      vi.stubEnv("RESEND_FROM", "Axial <test@example.com>");
      vi.stubEnv("SMSGO_API_KEY", "test-key");
      vi.stubEnv("SMSGO_SMS_TYPE_ID", "42");
      vi.stubEnv("META_ACCESS_TOKEN", "test-token");
      vi.stubEnv("META_PHONE_NUMBER_ID", "12345");
      vi.stubEnv("META_TEMPLATE_NAME", "approved_template");
      vi.stubEnv("META_LANGUAGE_CODE", "pt_BR");
      vi.stubEnv("META_GRAPH_VERSION", "v22.0");

      const fetchMock = vi.fn(async (url: string, _init: RequestInit) => {
        if (url.endsWith("/auth/token")) return new Response(JSON.stringify({ token: "test-token" }));
        if (url === endpoint)
          return new Response(
            JSON.stringify(channel === "whatsapp" ? { messages: [{ id: providerId }] } : { id: providerId }),
          );
        throw new Error(`Unexpected fetch: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      const delivery = {
        id: "delivery-id",
        channel,
        destination,
        payload: { type: "task.updated" },
        attempts: 0,
        organization_id: "org",
        user_id: "user",
      };
      mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
      mocks.clientQuery.mockImplementation(async (sql: string) =>
        sql.startsWith("SELECT d.id") ? { rows: [delivery] } : { rows: [] },
      );
      mocks.query.mockImplementation(async (sql: string) =>
        sql.startsWith("SELECT 1") ? { rowCount: 1 } : { rowCount: 1 },
      );

      const provider = configuredProvider();
      expect(provider?.channels).toEqual(["email", "sms", "whatsapp"]);
      if (!provider) throw new Error("Provider was not configured");
      expect(await dispatchOne(provider)).toBe(true);
      expect(fetchMock.mock.calls.some(([url]) => url === endpoint)).toBe(true);
      if (channel === "sms") {
        const request = fetchMock.mock.calls.find(([url]) => url === endpoint);
        expect(JSON.parse(String(request?.[1].body))).toMatchObject({ sms_type_id: 42 });
      }
      expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("p.verified_at IS NOT NULL"), [
        ["email", "sms", "whatsapp"],
      ]);
      expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("status='accepted'"), [
        "delivery-id",
        providerId,
        1,
      ]);
      expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("verified_at IS NOT NULL"), [
        "org",
        "user",
        channel,
        destination,
      ]);
    },
  );
});
