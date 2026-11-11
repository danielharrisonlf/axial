import { describe, expect, it } from "vitest";
import { notificationEvents, notificationTemplates, providerStatus } from "../src/catalog.js";

const empty = {} as NodeJS.ProcessEnv;

describe("notification catalog", () => {
  it("lists unique task events with generic text", () => {
    const events = notificationTemplates.map((template) => template.event);
    expect(new Set(events).size).toBe(events.length);
    expect([...notificationEvents].sort()).toEqual([...events].sort());
    for (const template of notificationTemplates) {
      expect(template.event.startsWith("task.")).toBe(true);
      expect(template.subject).not.toContain("{");
      expect(template.body).not.toContain("{");
    }
  });

  it("reports only complete channel configurations and never exposes secrets", () => {
    expect(providerStatus(empty).map((item) => item.configured)).toEqual([false, false, false]);
    const partial = {
      RESEND_API_KEY: "secret",
      META_ACCESS_TOKEN: "secret",
      NOTIFICATIONS_VERIFICATION_PEPPER: "secret",
      NOTIFICATIONS_VERIFY_EMAIL: "true",
    } as NodeJS.ProcessEnv;
    expect(providerStatus(partial).map((item) => item.configured)).toEqual([false, false, false]);
    const complete = {
      ...partial,
      RESEND_FROM: "sender@example.test",
      NOTIFICATIONS_VERIFY_EMAIL: "true",
    } as NodeJS.ProcessEnv;
    expect(providerStatus(complete).every((item) => !item.configured)).toBe(true);
    const enabled = {
      ...complete,
      NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION: "true",
    } as NodeJS.ProcessEnv;
    const status = providerStatus(enabled);
    expect(status.map((item) => item.configured)).toEqual([true, false, false]);
    expect(status.find((item) => item.channel === "email")?.verification).toBe(true);
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("reports the HTTPS gateway as the configured provider for every channel", () => {
    const status = providerStatus({
      NOTIFICATIONS_TRUST_EXTERNAL_VERIFICATION: "true",
      NOTIFICATIONS_PROVIDER_URL: "https://gateway.example.test/send",
      NOTIFICATIONS_PROVIDER_TOKEN: "token",
    } as NodeJS.ProcessEnv);
    expect(status.every((item) => item.configured)).toBe(true);
    expect(status.every((item) => item.provider === "HTTPS gateway")).toBe(true);
  });
});
