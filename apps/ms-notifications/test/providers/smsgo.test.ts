import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSmsGo } from "../../src/providers/smsgo.js";

const input = { id: "delivery-1", destination: "+5511999990000", eventType: "task.assigned" };
const config = { apiKey: "test_secret", smsTypeId: 5 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

describe("SMSGo", () => {
  it("exchanges the key and sends a single message with a reference", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ token: "oat_token", mode: "test" }))
      .mockResolvedValueOnce(json({ id: "provider-id", status: "queued", test: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendSmsGo(input, config)).resolves.toBe("provider-id");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.smsgo.com.br/v1/auth/token");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { "SMSGo-key": "test_secret" },
      signal: expect.any(AbortSignal),
    });
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.smsgo.com.br/v1/sms/send/single");
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { authorization: "Bearer oat_token", "content-type": "application/json" },
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(options.body)).toEqual({
      phone: input.destination,
      message: expect.any(String),
      reference: input.id,
      sms_type_id: config.smsTypeId,
    });
  });

  it("does not attempt a send on failed authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ token: "test_secret" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendSmsGo(input, config)).rejects.toThrow("SMSGo authentication HTTP 401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed or ambiguous send and does not leak errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ token: "oat_token" }))
      .mockRejectedValueOnce(new Error("test_secret oat_token"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendSmsGo(input, config)).rejects.toThrow("SMSGo send request failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed responses and input", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ token: "oat_token" }))
      .mockResolvedValueOnce(json({}));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendSmsGo(input, config)).rejects.toThrow("SMSGo send invalid response");
    await expect(sendSmsGo({ ...input, destination: "11999990000" }, config)).rejects.toThrow(
      "Invalid SMSGo input",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(sendSmsGo(input, { ...config, smsTypeId: 0 })).rejects.toThrow(
      "Invalid SMSGo configuration",
    );
    await expect(sendSmsGo(input, { ...config, smsTypeId: 1.5 })).rejects.toThrow(
      "Invalid SMSGo configuration",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
