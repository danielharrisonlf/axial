import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn() }));
vi.mock("../../src/db.js", () => ({ db: { connect: mocks.connect } }));

import { beginVerification, VerificationUnavailableError } from "../../src/verification.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("sends an SMS verification code using the explicitly configured SMS type", async () => {
  vi.stubEnv("NOTIFICATIONS_VERIFICATION_PEPPER", Buffer.alloc(32, 1).toString("base64"));
  vi.stubEnv("NOTIFICATIONS_VERIFY_SMS", "true");
  vi.stubEnv("SMSGO_API_KEY", "fake-key");
  vi.stubEnv("SMSGO_VERIFICATION_SMS_TYPE_ID", "42");
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT destination"))
      return { rowCount: 1, rows: [{ destination: "+5511999990000" }] };
    return { rowCount: 1, rows: [] };
  });
  const fetchMock = vi.fn(async (url: string, _options: RequestInit) => {
    if (url === "https://api.smsgo.com.br/v1/auth/token") return new Response('{"token":"fake-token"}');
    if (url === "https://api.smsgo.com.br/v1/sms/send/single") return new Response("{}");
    throw new Error("Unexpected URL");
  });
  vi.stubGlobal("fetch", fetchMock);
  await beginVerification({ sub: "user", organizationId: "org" }, "sms");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1].body));
  expect(body).toMatchObject({ phone: "+5511999990000", sms_type_id: 42 });
  expect(body.message).toMatch(/\b\d{6}\b/);
  expect(mocks.release).toHaveBeenCalledOnce();
});

it.each(["", "0", "-1", "1.5", "9007199254740992"])(
  "rejects invalid SMS type %j before any database or network call",
  async (typeId) => {
    vi.stubEnv("NOTIFICATIONS_VERIFICATION_PEPPER", Buffer.alloc(32, 1).toString("base64"));
    vi.stubEnv("NOTIFICATIONS_VERIFY_SMS", "true");
    vi.stubEnv("SMSGO_API_KEY", "fake-key");
    vi.stubEnv("SMSGO_VERIFICATION_SMS_TYPE_ID", typeId);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(beginVerification({ sub: "user", organizationId: "org" }, "sms")).rejects.toBeInstanceOf(
      VerificationUnavailableError,
    );
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
