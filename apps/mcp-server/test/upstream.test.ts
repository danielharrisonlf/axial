import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { errorText } from "../src/mcp/errors.filter.js";
import { compact, queryString, upstreamError } from "../src/upstream.js";

describe("mcp upstream helpers", () => {
  it("builds query strings and skips empty values", () => {
    expect(queryString({ search: "checkout", page: 2, status: undefined, assigneeId: null })).toBe(
      "?search=checkout&page=2",
    );
    expect(queryString({})).toBe("");
  });

  it("drops undefined properties from request bodies but keeps null (clears a field)", () => {
    expect(compact({ title: "Task", description: undefined, assigneeId: null })).toEqual({
      title: "Task",
      assigneeId: null,
    });
  });

  it("maps upstream statuses to exceptions with guidance for the model", () => {
    expect(upstreamError(401, {})).toBeInstanceOf(UnauthorizedException);
    expect(upstreamError(403, { message: "nope" })).toBeInstanceOf(ForbiddenException);
    expect(upstreamError(404, { message: "gone" })).toBeInstanceOf(NotFoundException);
    expect(upstreamError(500, {})).toBeInstanceOf(BadGatewayException);
    const conflict = upstreamError(409, { message: "Version conflict; reload the resource" });
    expect(conflict).toBeInstanceOf(ConflictException);
    expect(errorText(conflict)).toMatch(
      /^Conflict \[409\]: Version conflict; reload the resource\. Read the resource again/,
    );
  });

  it("passes validation issues on, bounded, and never long or internal text", () => {
    const invalid = upstreamError(400, {
      message: "Validation failed",
      issues: [
        { path: "title", message: "Too small" },
        { path: "dueDate", message: "Invalid date" },
      ],
    });
    expect(invalid).toBeInstanceOf(BadRequestException);
    expect(errorText(invalid)).toBe(
      "Invalid request [400]: Validation failed — title: Too small; dueDate: Invalid date",
    );
    expect(errorText(upstreamError(403, { message: "x".repeat(400) }))).not.toContain("xxxx");
    expect(errorText(upstreamError(502, { message: "ECONNREFUSED 10.0.0.4:5432" }, "audit"))).toBe(
      "Upstream unavailable [502]: Audit API unavailable; try again later",
    );
  });

  it("keeps a safe correlation id and drops an unsafe one", () => {
    expect(errorText(upstreamError(404, { correlationId: "req-1" }))).toContain("(correlation id req-1)");
    expect(errorText(upstreamError(404, { correlationId: "<script>" }))).not.toContain("script");
  });
});
