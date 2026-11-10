import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMeta } from "../../src/providers/meta.js";

const input = { id: "event-1", destination: "5511999999999", eventType: "task.created" };
const config = {
  accessToken: "secret-token",
  phoneNumberId: "12345",
  templateName: "approved_template",
  languageCode: "pt_BR",
  graphVersion: "v22.0",
};

afterEach(() => vi.unstubAllGlobals());

describe("sendMeta", () => {
  it("sends the approved template and returns the Meta message ID", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.123" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMeta(input, config)).resolves.toBe("wamid.123");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v22.0/12345/messages");
    expect(request.method).toBe("POST");
    expect(request.redirect).toBe("error");
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.headers).toEqual({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(request.body)).toEqual({
      messaging_product: "whatsapp",
      to: input.destination,
      type: "template",
      template: { name: "approved_template", language: { code: "pt_BR" } },
    });
  });

  it.each([
    ["HTTP rejection", () => Promise.resolve(new Response("secret-token 5511999999999", { status: 400 }))],
    ["network error", () => Promise.reject(new Error("secret-token 5511999999999"))],
    ["invalid JSON", () => Promise.resolve(new Response("invalid", { status: 200 }))],
    ["missing ID", () => Promise.resolve(new Response('{"messages":[]}', { status: 200 }))],
  ])("sanitizes %s", async (_name, implementation) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(implementation));
    await expect(sendMeta(input, config)).rejects.toThrow("Meta WhatsApp send failed");
  });

  it.each([
    { ...config, phoneNumberId: "../other" },
    { ...config, graphVersion: "v22.0/other" },
    { ...config, accessToken: "token\r\nheader" },
    { ...config, templateName: "" },
  ])("rejects invalid configuration before calling fetch", async (invalid) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMeta(input, invalid)).rejects.toThrow(
      "Invalid Meta WhatsApp configuration or destination",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid destination before calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMeta({ ...input, destination: "not-a-number" }, config)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
