import { describe, expect, it } from "vitest";
import { boardMarkdown, isOverdue, openBlockers } from "../src/format.js";
import type { Project, Task } from "../src/schemas.js";

const task = (ref: string, extra: Partial<Task> = {}): Task => ({
  id: ref,
  projectId: "p",
  ref,
  title: ref,
  description: "",
  type: "task",
  status: "todo",
  priority: "medium",
  assigneeId: null,
  teamId: null,
  epicId: null,
  sprintId: null,
  parentId: null,
  labels: [],
  acceptanceCriteria: [],
  estimate: null,
  position: 0,
  startDate: null,
  dueDate: null,
  completedAt: null,
  version: 1,
  dependencies: [],
  createdAt: "",
  updatedAt: "",
  ...extra,
});

describe("format", () => {
  it("flags overdue only for unfinished tasks", () => {
    expect(isOverdue(task("A", { dueDate: "2000-01-01T00:00:00Z" }))).toBe(true);
    expect(isOverdue(task("B", { dueDate: "2000-01-01T00:00:00Z", status: "done" }))).toBe(false);
  });

  it("counts only open blockers", () => {
    const done = task("D", { status: "done" });
    const open = task("O");
    const blocked = task("X", { dependencies: [{ dependsOnId: "D" }, { dependsOnId: "O" }] });
    expect(openBlockers(blocked, new Map([done, open].map((item) => [item.id, item])))).toEqual(["O"]);
  });

  it("renders every column and the hidden remainder", () => {
    const markdown = boardMarkdown({ key: "CHK", name: "Checkout" } as Project, [
      { status: "todo", items: [task("CHK-1")], total: 3 },
      { status: "done", items: [], total: 0 },
    ]);
    expect(markdown).toContain("## A fazer (3)");
    expect(markdown).toContain("- … e mais 2 (use list-tasks com status=todo)");
    expect(markdown).toContain("## Concluído (0)\n\n_vazio_");
  });
});
