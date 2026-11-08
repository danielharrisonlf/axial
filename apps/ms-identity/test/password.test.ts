import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/password.js";

describe("password hashing", () => {
  it("salts hashes and verifies without exposing the password", async () => {
    const first = await hashPassword("a long unique password");
    const second = await hashPassword("a long unique password");
    expect(first).not.toEqual(second);
    expect(first).not.toContain("a long unique password");
    expect(await verifyPassword("a long unique password", first)).toBe(true);
    expect(await verifyPassword("incorrect password", first)).toBe(false);
    expect(await verifyPassword("anything", "bad")).toBe(false);
  });
});
