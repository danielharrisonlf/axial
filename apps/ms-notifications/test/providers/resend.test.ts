import { afterEach, describe, expect, it, vi } from "vitest";
import { sendResend } from "../../src/providers/resend.js";

const config = { apiKey: "re_secret", from: "Axial <notifications@example.com>" };
const input = { id: "delivery-123", destination: "user@example.com", eventType: "task.updated" };

afterEach(() => vi.unstubAllGlobals());

describe("sendResend", () => {
  it("sends a plain-text task email and returns the accepted provider id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "provider-123" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendResend(input, config)).resolves.toBe("provider-123");
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        authorization: "Bearer re_secret",
        "content-type": "application/json",
        "idempotency-key": input.id,
      },
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request.body)).toEqual({
      from: config.from,
      to: [input.destination],
      subject: "Atualização de tarefa no Axial",
      text: "Há uma atualização em uma tarefa atribuída a você. Acesse o Axial para conferir.",
    });
  });

  it("uses the same idempotency key and payload on retries and does not embed arbitrary event text", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: "same-id" })));
    vi.stubGlobal("fetch", fetchMock);
    const malicious = { ...input, eventType: '<img src=x onerror="alert(1)">' };
    await sendResend(malicious, config);
    await sendResend(malicious, config);
    expect(fetchMock.mock.calls[0][1].headers["idempotency-key"]).toBe(input.id);
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
    expect(fetchMock.mock.calls[0][1].body).not.toContain(malicious.eventType);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).subject).toBe("Notificação do Axial");
  });

  it.each([
    ["HTTP error", () => Promise.resolve(new Response("re_secret user@example.com", { status: 400 }))],
    ["invalid JSON", () => Promise.resolve(new Response("re_secret"))],
    ["missing id", () => Promise.resolve(new Response("{}"))],
    ["empty id", () => Promise.resolve(new Response('{"id":" "}'))],
    ["network error", () => Promise.reject(new Error("re_secret user@example.com"))],
  ])("sanitizes %s", async (_name, implementation) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(implementation));
    await expect(sendResend(input, config)).rejects.toThrow(/^Resend request failed$/);
  });

  it.each([
    [{ ...input, id: "" }, config],
    [{ ...input, id: "x".repeat(257) }, config],
    [{ ...input, destination: "user@example.com\r\nBcc: other@example.com" }, config],
    [input, { ...config, apiKey: "bad\nkey" }],
    [input, { ...config, from: "bad\nfrom" }],
  ])("rejects unsafe input without a request", async (badInput, badConfig) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendResend(badInput, badConfig)).rejects.toThrow(/^Resend request failed$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
