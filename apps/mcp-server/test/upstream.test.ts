import { BadGatewayException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { compact, queryString, upstreamError } from "../src/upstream.js";

describe("mcp upstream helpers", () => {
  it("builds query strings and skips empty values", () => {
    expect(queryString({ search: "checkout", page: 2, status: undefined, assigneeId: null })).toBe(
      "?search=checkout&page=2",
    );
    expect(queryString({})).toBe("");
  });

  it("drops undefined properties from request bodies", () => {
    expect(compact({ title: "Task", description: undefined, priority: "high" })).toEqual({
      title: "Task",
      priority: "high",
    });
  });

  it("maps upstream statuses to HTTP exceptions", () => {
    expect(upstreamError(403, { message: "nope" })).toBeInstanceOf(ForbiddenException);
    expect(upstreamError(404, { message: "gone" })).toBeInstanceOf(NotFoundException);
    expect(upstreamError(500, {})).toBeInstanceOf(BadGatewayException);
    expect(upstreamError(400, { message: "bad" }).getStatus()).toBe(400);
  });
});
