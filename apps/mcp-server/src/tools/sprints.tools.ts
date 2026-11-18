import { HttpException, Inject, Injectable } from "@nestjs/common";
import { type McpContext, Tool } from "@nestjs/mcp";
import { z } from "zod";
import { requireConfirmation } from "../mcp/confirmation.js";
import { errorText } from "../mcp/errors.filter.js";
import { McpPrimitives } from "../mcp/primitives.js";
import {
  confirm,
  DESTRUCTIVE,
  id,
  page,
  pageOf,
  pageSize,
  READ_ONLY,
  type Sprint,
  sprintFields,
  sprintOut,
  type Task,
  version,
  WRITE,
  WRITE_IDEMPOTENT,
} from "../schemas.js";
import { READ_SCOPE, WRITE_SCOPE } from "../scopes.js";
import { AxialApi } from "../upstream.js";

const read = [READ_SCOPE];
const write = [WRITE_SCOPE];

const ListSprints = z.object({
  projectId: z
    .uuid()
    .optional()
    .describe("Only this project; omit to list across every project the caller can read"),
  page,
  pageSize,
});
const SprintId = z.object({ sprintId: id("Sprint id (from list-sprints)") });
const CreateSprint = z.object({ projectId: id("Project id"), ...sprintFields });
const UpdateSprint = z.object({
  sprintId: id("Sprint id"),
  version: version("sprint"),
  name: sprintFields.name.optional(),
  goal: sprintFields.goal,
  startDate: sprintFields.startDate.optional(),
  endDate: sprintFields.endDate.optional(),
});
const SprintVersion = z.object({ sprintId: id("Sprint id"), version: version("sprint") });
const SprintConfirm = SprintVersion.extend({ confirm });
const AssignToSprint = z.object({
  sprintId: z
    .uuid()
    .nullable()
    .describe("Target sprint id of the same project, or null to move the tasks back to the backlog"),
  taskIds: z.array(z.uuid()).min(1).max(50).describe("Task ids to (re)plan, at most 50 per call"),
});

type Input<T extends z.ZodType> = z.infer<T>;

interface AssignmentOutcome {
  taskId: string;
  ref?: string;
  ok: boolean;
  version?: number;
  error?: string;
}

/** Sprint planning: create, start, complete, delete and plan tasks into sprints. */
@Injectable()
@McpPrimitives()
export class SprintTools {
  constructor(@Inject(AxialApi) private readonly api: AxialApi) {}

  @Tool({
    name: "list-sprints",
    title: "List sprints",
    description:
      "List sprints, by start date, with project, status (planned, active, done), dates, goal and version: of one project, or across every project the caller can read when projectId is omitted. Only one sprint is active per project.",
    inputSchema: ListSprints,
    outputSchema: pageOf(sprintOut),
    annotations: READ_ONLY,
    scopes: read,
  })
  listSprints(query: Input<typeof ListSprints>, ctx: McpContext) {
    return this.api.get(ctx, "projects", "/sprints", query);
  }

  @Tool({
    name: "get-sprint",
    title: "Get sprint",
    description: "Read one sprint. Use list-tasks with sprintId to see its tasks.",
    inputSchema: SprintId,
    outputSchema: sprintOut,
    annotations: READ_ONLY,
    scopes: read,
  })
  getSprint({ sprintId }: Input<typeof SprintId>, ctx: McpContext) {
    return this.api.get(ctx, "projects", `/sprints/${sprintId}`);
  }

  @Tool({
    name: "create-sprint",
    title: "Create sprint",
    description: "Create a planned sprint in a project. The end must be strictly after the start.",
    inputSchema: CreateSprint,
    annotations: WRITE,
    scopes: write,
  })
  createSprint({ projectId, ...body }: Input<typeof CreateSprint>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/projects/${projectId}/sprints`, { method: "POST", body });
  }

  @Tool({
    name: "update-sprint",
    title: "Update sprint",
    description:
      "Rename, re-goal or reschedule a planned or active sprint. Needs the current sprint version.",
    inputSchema: UpdateSprint,
    annotations: WRITE_IDEMPOTENT,
    scopes: write,
  })
  updateSprint({ sprintId, ...body }: Input<typeof UpdateSprint>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/sprints/${sprintId}`, { method: "PATCH", body });
  }

  @Tool({
    name: "start-sprint",
    title: "Start sprint",
    description:
      "Start a planned sprint. Fails with a conflict when the project already has an active sprint. Needs the current sprint version.",
    inputSchema: SprintVersion,
    annotations: WRITE,
    scopes: write,
  })
  startSprint({ sprintId, ...body }: Input<typeof SprintVersion>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/sprints/${sprintId}/start`, { method: "POST", body });
  }

  @Tool({
    name: "complete-sprint",
    title: "Complete sprint",
    description:
      "Complete the active sprint: every unfinished task goes back to the backlog (no sprint, status backlog) in the same transaction, and the sprint content becomes immutable. Asks the user to confirm. Needs the current sprint version.",
    inputSchema: SprintConfirm,
    annotations: DESTRUCTIVE,
    scopes: write,
  })
  async completeSprint(
    { sprintId, version: current, confirm: ok }: Input<typeof SprintConfirm>,
    ctx: McpContext,
  ) {
    const sprint = await this.api.get<Sprint>(ctx, "projects", `/sprints/${sprintId}`);
    const count = (status?: string) =>
      this.api
        .get<{ total: number }>(ctx, "projects", `/projects/${sprint.projectId}/tasks`, {
          sprintId,
          status,
          pageSize: 1,
        })
        .then((result) => result.total);
    const [all, done] = await Promise.all([count(), count("done")]);
    const decision = requireConfirmation(
      ctx,
      ok,
      `Complete sprint "${sprint.name}"? ${all - done} of its ${all} tasks are unfinished and will return to the backlog.`,
    );
    if (decision.status === "pending") return decision.result;
    if (decision.status === "declined") return decision.message;
    return this.api.request(ctx, "projects", `/sprints/${sprintId}/complete`, {
      method: "POST",
      body: { version: current },
    });
  }

  @Tool({
    name: "delete-sprint",
    title: "Delete sprint",
    description:
      "Delete an empty planned sprint. Irreversible: asks the user to confirm. Needs the current sprint version.",
    inputSchema: SprintConfirm,
    annotations: DESTRUCTIVE,
    scopes: write,
  })
  async deleteSprint(
    { sprintId, version: current, confirm: ok }: Input<typeof SprintConfirm>,
    ctx: McpContext,
  ) {
    const sprint = await this.api.get<Sprint>(ctx, "projects", `/sprints/${sprintId}`);
    const decision = requireConfirmation(ctx, ok, `Delete sprint "${sprint.name}" permanently?`);
    if (decision.status === "pending") return decision.result;
    if (decision.status === "declined") return decision.message;
    return this.api.request(ctx, "projects", `/sprints/${sprintId}`, {
      method: "DELETE",
      query: { version: current },
    });
  }

  @Tool({
    name: "assign-tasks-to-sprint",
    title: "Plan tasks into a sprint",
    description:
      "Move up to 50 tasks into a sprint, or back to the backlog with sprintId null. Each task is read and updated with its own current version, one at a time, with progress notifications; the result lists the outcome of every task (a failure does not undo the others). Tasks of completed sprints cannot move.",
    inputSchema: AssignToSprint,
    annotations: WRITE_IDEMPOTENT,
    scopes: write,
  })
  async assignToSprint({ sprintId, taskIds }: Input<typeof AssignToSprint>, ctx: McpContext) {
    const unique = [...new Set(taskIds)];
    const results: AssignmentOutcome[] = [];
    for (const [index, taskId] of unique.entries()) {
      if (ctx.signal.aborted) break;
      let ref: string | undefined;
      try {
        const task = await this.api.get<Task>(ctx, "projects", `/tasks/${taskId}`);
        ref = task.ref;
        if (task.sprintId === sprintId) results.push({ taskId, ref, ok: true, version: task.version });
        else {
          const updated = await this.api.request<Task>(ctx, "projects", `/tasks/${taskId}`, {
            method: "PATCH",
            body: { version: task.version, sprintId },
          });
          results.push({ taskId, ref, ok: true, version: updated.version });
        }
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        results.push({ taskId, ref, ok: false, error: errorText(error) });
      }
      await ctx.reportProgress(
        index + 1,
        unique.length,
        `${ref ?? taskId}: ${results.at(-1)?.ok ? "ok" : "failed"}`,
      );
    }
    const succeeded = results.filter((result) => result.ok).length;
    return { sprintId, processed: results.length, succeeded, failed: results.length - succeeded, results };
  }
}
