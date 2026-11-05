import { describe, expect, it } from "vitest";
import {
  createCommentSchema,
  createEpicSchema,
  createMilestoneSchema,
  createProjectSchema,
  createSprintSchema,
  createTaskSchema,
  moveTaskSchema,
  paginationSchema,
  projectListSchema,
  taskListSchema,
  updateCommentSchema,
  updateEpicSchema,
  updateMilestoneSchema,
  updateProjectSchema,
  updateSprintSchema,
  updateTaskSchema,
  versionSchema,
} from "./index.js";

const id = "de305d54-75b4-431b-adb2-eb6b9e546014";
const validDate = "2026-11-05T12:00:00.000Z";

describe("shared request contracts", () => {
  it("preserves PATCH omission instead of injecting creation defaults or clearing existing fields", () => {
    expect(updateTaskSchema.parse({ version: 1, title: "Renamed" })).toEqual({
      version: 1,
      title: "Renamed",
    });
    expect(updateProjectSchema.parse({ version: 1, name: "Renamed" })).toEqual({
      version: 1,
      name: "Renamed",
    });
    expect(updateEpicSchema.parse({ version: 1, title: "Renamed" })).toEqual({
      version: 1,
      title: "Renamed",
    });
    expect(updateSprintSchema.parse({ version: 1, name: "Renamed" })).toEqual({
      version: 1,
      name: "Renamed",
    });
  });
  it("normalizes and bounds pagination inputs", () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(paginationSchema.parse({ page: "2", pageSize: "100" })).toEqual({ page: 2, pageSize: 100 });
    expect(paginationSchema.safeParse({ page: "0" }).success).toBe(false);
    expect(paginationSchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });

  it("rejects unknown request keys rather than silently accepting mass assignment", () => {
    expect(createProjectSchema.safeParse({ key: "AX", name: "Alpha", organizationId: id }).success).toBe(
      false,
    );
    expect(updateTaskSchema.safeParse({ version: 1, createdBy: id }).success).toBe(false);
    expect(createCommentSchema.safeParse({ body: "hello", authorId: id }).success).toBe(false);
  });

  it("requires a positive integer version for optimistic writes", () => {
    expect(versionSchema.safeParse({ version: 1 }).success).toBe(true);
    for (const version of [0, -1, 1.5, "1", null]) {
      expect(versionSchema.safeParse({ version }).success).toBe(false);
    }
    expect(updateProjectSchema.safeParse({ name: "Renamed" }).success).toBe(false);
    expect(updateEpicSchema.safeParse({ title: "Renamed" }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ title: "Renamed" }).success).toBe(false);
    expect(updateSprintSchema.safeParse({ name: "Renamed" }).success).toBe(false);
    expect(updateCommentSchema.safeParse({ body: "Renamed" }).success).toBe(false);
    expect(updateMilestoneSchema.safeParse({ name: "Renamed" }).success).toBe(false);
  });

  it("trims bounded text and applies documented creation defaults", () => {
    expect(createProjectSchema.parse({ key: "A1", name: "  Alpha  " })).toMatchObject({
      key: "A1",
      name: "Alpha",
      description: "",
      priority: "medium",
      teamIds: [],
    });
    expect(createEpicSchema.parse({ title: "  Roadmap  " })).toMatchObject({
      title: "Roadmap",
      description: "",
    });
    expect(createTaskSchema.parse({ title: "  Ship  " })).toMatchObject({
      title: "Ship",
      type: "task",
      status: "backlog",
      priority: "medium",
      labels: [],
      acceptanceCriteria: [],
    });
    expect(createCommentSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(createCommentSchema.safeParse({ body: "x".repeat(10_001) }).success).toBe(false);
  });

  it("validates project keys, IDs, and bounded collections", () => {
    expect(createProjectSchema.safeParse({ key: "ax", name: "Alpha" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ key: "A", name: "Alpha" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ key: "A".repeat(13), name: "Alpha" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ key: "AX", name: "Alpha", leadId: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(
      createProjectSchema.safeParse({ key: "AX", name: "Alpha", teamIds: Array(101).fill(id) }).success,
    ).toBe(false);
  });

  it("constrains task workflow fields and validates dependency references", () => {
    expect(createTaskSchema.safeParse({ title: "T", status: "blocked" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "T", type: "story" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "T", blockedByIds: ["not-a-uuid"] }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "T", estimate: -1 }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "T", position: 100_000_001 }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "T", acceptanceCriteria: ["  "] }).success).toBe(false);
    expect(updateTaskSchema.parse({ version: 1, status: "in_progress" })).toMatchObject({
      version: 1,
      status: "in_progress",
    });
    expect(moveTaskSchema.safeParse({ version: 1, status: "done", position: -1 }).success).toBe(false);
  });

  it("requires timezone-qualified ISO datetimes and valid sprint order data shapes", () => {
    expect(
      createSprintSchema.safeParse({
        name: "Sprint 1",
        startDate: validDate,
        endDate: "2026-11-12T12:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      createSprintSchema.safeParse({ name: "Sprint 1", startDate: "2026-11-05", endDate: validDate }).success,
    ).toBe(false);
    expect(createMilestoneSchema.safeParse({ name: "Release", date: validDate }).success).toBe(true);
    expect(createMilestoneSchema.safeParse({ name: "Release", date: "not-a-date" }).success).toBe(false);
    expect(updateMilestoneSchema.safeParse({ version: 1, completed: true }).success).toBe(true);
  });

  it("accepts only known list filters and documented archive flags", () => {
    expect(projectListSchema.parse({ archived: "true", status: "paused" })).toMatchObject({
      archived: "true",
      status: "paused",
      page: 1,
    });
    expect(projectListSchema.safeParse({ archived: "yes" }).success).toBe(false);
    expect(projectListSchema.safeParse({ organizationId: id }).success).toBe(false);
    expect(taskListSchema.safeParse({ status: "done", priority: "urgent", assigneeId: id }).success).toBe(
      true,
    );
    expect(taskListSchema.safeParse({ status: "blocked" }).success).toBe(false);
  });
});
