import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { type McpContext, Tool } from "@nestjs/mcp";
import { z } from "zod";
import { requireConfirmation } from "../mcp/confirmation.js";
import { McpPrimitives } from "../mcp/primitives.js";
import {
  commentBody,
  confirm,
  DESTRUCTIVE,
  id,
  page,
  pageOf,
  pageSize,
  priority,
  READ_ONLY,
  type Task,
  taskFields,
  taskOut,
  taskStatus,
  taskType,
  version,
  WRITE,
  WRITE_IDEMPOTENT,
} from "../schemas.js";
import { READ_SCOPE, WRITE_SCOPE } from "../scopes.js";
import { AxialApi } from "../upstream.js";

const read = [READ_SCOPE];
const write = [WRITE_SCOPE];

const ListTasks = z.object({
  projectId: id("Project id"),
  search: z
    .string()
    .max(240)
    .optional()
    .describe("Text matched against task title and reference (e.g. CHK-12)"),
  status: taskStatus.optional(),
  priority: priority.optional(),
  assigneeId: z.uuid().optional().describe("Only tasks assigned to this user"),
  teamId: z.uuid().optional().describe("Only tasks of this team"),
  epicId: z.uuid().optional().describe("Only tasks of this epic"),
  sprintId: z.uuid().optional().describe("Only tasks of this sprint"),
  parentId: z.uuid().optional().describe("Only subtasks of this task"),
  label: z.string().max(40).optional().describe("Only tasks carrying this label"),
  page,
  pageSize,
});
const SearchTasks = z.object({
  projectId: z.uuid().optional().describe("Only tasks of this project"),
  search: z
    .string()
    .max(240)
    .optional()
    .describe("Text matched against task title and reference (e.g. CHK-12)"),
  status: taskStatus.optional(),
  assigneeId: z
    .uuid()
    .optional()
    .describe("Only tasks assigned to this user (the caller's id is in axial://me)"),
  dueBefore: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("Only tasks due before this ISO 8601 timestamp with offset (e.g. now, for overdue work)"),
  page,
  pageSize,
});
const TaskId = z.object({ taskId: id("Task id (from list-tasks)") });
const CreateTask = z.object({
  projectId: id("Project that will own the task"),
  ...taskFields,
  type: taskType.optional(),
  parentId: z.uuid().nullable().optional().describe("Parent task id, for a subtask (one level only)"),
});
const { title, ...optionalFields } = taskFields;
const UpdateTask = z.object({
  taskId: id("Task id"),
  version: version("task"),
  title: title.optional(),
  ...optionalFields,
});
const MoveTask = z.object({
  taskId: id("Task id"),
  status: taskStatus.describe("The new Kanban status"),
  version: version("task"),
  position: taskFields.position,
});
const AssignTask = z.object({
  taskId: id("Task id"),
  version: version("task"),
  assigneeId: z.uuid().nullable().describe("User id to assign, or null to unassign"),
});
const Dependencies = z
  .object({
    taskId: id("Task whose blockers change"),
    version: version("task"),
    add: z
      .array(z.uuid())
      .max(100)
      .optional()
      .describe("Task ids of the same project that must finish first"),
    remove: z.array(z.uuid()).max(100).optional().describe("Blocker task ids to drop"),
  })
  .refine((value) => (value.add?.length ?? 0) + (value.remove?.length ?? 0) > 0, "Give add or remove");
const DeleteTask = z.object({ taskId: id("Task id"), version: version("task"), confirm });
const ListComments = z.object({ taskId: id("Task id"), page, pageSize });
const AddComment = z.object({ taskId: id("Task id"), body: commentBody });
const UpdateComment = z.object({
  commentId: id("Comment id"),
  version: version("comment"),
  body: commentBody,
});
const DeleteComment = z.object({
  commentId: id("Comment id"),
  version: version("comment"),
  confirm,
});

type Input<T extends z.ZodType> = z.infer<T>;

/** Tasks, Kanban moves, assignment, dependencies and comments. */
@Injectable()
@McpPrimitives()
export class TaskTools {
  constructor(@Inject(AxialApi) private readonly api: AxialApi) {}

  @Tool({
    name: "list-tasks",
    title: "List tasks",
    description:
      "List and filter the tasks of a project (status, priority, assignee, team, epic, sprint, parent, label, text). Ordered by board position. Each task carries its ref (KEY-n), version and blocking dependencies.",
    inputSchema: ListTasks,
    outputSchema: pageOf(taskOut),
    annotations: READ_ONLY,
    scopes: read,
  })
  listTasks({ projectId, ...filters }: Input<typeof ListTasks>, ctx: McpContext) {
    return this.api.get(ctx, "projects", `/projects/${projectId}/tasks`, filters);
  }

  @Tool({
    name: "search-tasks",
    title: "Search tasks across projects",
    description:
      "Search tasks across every project the caller can read, newest first: by text, status, assignee, project or due date. Use it for 'my open tasks' or 'what is overdue'; use list-tasks for one project's board order and finer filters.",
    inputSchema: SearchTasks,
    outputSchema: pageOf(taskOut),
    annotations: READ_ONLY,
    scopes: read,
  })
  searchTasks(query: Input<typeof SearchTasks>, ctx: McpContext) {
    return this.api.get(ctx, "projects", "/tasks", query);
  }

  @Tool({
    name: "get-task",
    title: "Get task",
    description:
      "Read one task: description, acceptance criteria, planning fields, blocking dependencies and current version. Read it before changing it.",
    inputSchema: TaskId,
    outputSchema: taskOut,
    annotations: READ_ONLY,
    scopes: read,
  })
  getTask({ taskId }: Input<typeof TaskId>, ctx: McpContext) {
    return this.api.get(ctx, "projects", `/tasks/${taskId}`);
  }

  @Tool({
    name: "create-task",
    title: "Create task",
    description:
      "Create a task, bug or one-level subtask in a project. Confirm project and title with the user before calling it. Returns the task with its ref and version.",
    inputSchema: CreateTask,
    annotations: WRITE,
    scopes: write,
  })
  createTask({ projectId, ...body }: Input<typeof CreateTask>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/projects/${projectId}/tasks`, { method: "POST", body });
  }

  @Tool({
    name: "update-task",
    title: "Update task",
    description:
      "Change task fields. Omitted fields are kept; null clears a nullable field; arrays (labels, acceptanceCriteria, blockedByIds) replace the current list. Contributors may only change title, description, status and acceptance criteria of their own tasks. Needs the current version.",
    inputSchema: UpdateTask,
    annotations: WRITE_IDEMPOTENT,
    scopes: write,
  })
  updateTask({ taskId, ...body }: Input<typeof UpdateTask>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/tasks/${taskId}`, { method: "PATCH", body });
  }

  @Tool({
    name: "update-task-status",
    title: "Move task",
    description:
      "Move a task to another Kanban column, optionally setting its position. Done requires finished subtasks and blockers. Needs the current task version.",
    inputSchema: MoveTask,
    annotations: WRITE_IDEMPOTENT,
    scopes: write,
  })
  updateTaskStatus({ taskId, ...body }: Input<typeof MoveTask>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/tasks/${taskId}/status`, { method: "PATCH", body });
  }

  @Tool({
    name: "assign-task",
    title: "Assign task",
    description:
      "Assign a task to a user, or unassign it with null. The user must be assignable by the caller. Needs the current task version.",
    inputSchema: AssignTask,
    annotations: WRITE_IDEMPOTENT,
    scopes: write,
  })
  assignTask({ taskId, ...body }: Input<typeof AssignTask>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/tasks/${taskId}`, { method: "PATCH", body });
  }

  @Tool({
    name: "update-task-dependencies",
    title: "Change task blockers",
    description:
      "Add or remove tasks that block this task. Cycles, including the implicit parent/subtask ones, are rejected. Needs the current task version.",
    inputSchema: Dependencies,
    annotations: WRITE_IDEMPOTENT,
    scopes: write,
  })
  async updateDependencies(
    { taskId, version: current, add = [], remove = [] }: Input<typeof Dependencies>,
    ctx: McpContext,
  ) {
    if (add.includes(taskId)) throw new BadRequestException("A task cannot block itself");
    const task = await this.api.get<Task>(ctx, "projects", `/tasks/${taskId}`);
    const blockers = new Set((task.dependencies ?? []).map((dependency) => dependency.dependsOnId));
    for (const blocker of add) blockers.add(blocker);
    for (const blocker of remove) blockers.delete(blocker);
    return this.api.request(ctx, "projects", `/tasks/${taskId}`, {
      method: "PATCH",
      body: { version: current, blockedByIds: [...blockers] },
    });
  }

  @Tool({
    name: "delete-task",
    title: "Delete task",
    description:
      "Delete a task that has no subtasks, comments or dependents. Irreversible: asks the user to confirm. Needs the current task version.",
    inputSchema: DeleteTask,
    annotations: DESTRUCTIVE,
    scopes: write,
  })
  async deleteTask({ taskId, version: current, confirm: ok }: Input<typeof DeleteTask>, ctx: McpContext) {
    const task = await this.api.get<Task>(ctx, "projects", `/tasks/${taskId}`);
    const decision = requireConfirmation(ctx, ok, `Delete task ${task.ref} — "${task.title}" permanently?`);
    if (decision.status === "pending") return decision.result;
    if (decision.status === "declined") return decision.message;
    return this.api.request(ctx, "projects", `/tasks/${taskId}`, {
      method: "DELETE",
      query: { version: current },
    });
  }

  @Tool({
    name: "list-comments",
    title: "List comments",
    description: "List the comments of a task, with author, text and version.",
    inputSchema: ListComments,
    annotations: READ_ONLY,
    scopes: read,
  })
  listComments({ taskId, ...query }: Input<typeof ListComments>, ctx: McpContext) {
    return this.api.get(ctx, "projects", `/tasks/${taskId}/comments`, query);
  }

  @Tool({
    name: "add-comment",
    title: "Comment on task",
    description:
      "Add a comment to a task as the signed-in user (viewers cannot). Comments stay possible on tasks of completed sprints.",
    inputSchema: AddComment,
    annotations: WRITE,
    scopes: write,
  })
  addComment({ taskId, body }: Input<typeof AddComment>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/tasks/${taskId}/comments`, { method: "POST", body: { body } });
  }

  @Tool({
    name: "update-comment",
    title: "Edit comment",
    description: "Edit a comment, as its author or an authorized manager. Needs the current comment version.",
    inputSchema: UpdateComment,
    annotations: WRITE_IDEMPOTENT,
    scopes: write,
  })
  updateComment({ commentId, ...body }: Input<typeof UpdateComment>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/comments/${commentId}`, { method: "PATCH", body });
  }

  @Tool({
    name: "delete-comment",
    title: "Delete comment",
    description:
      "Delete a comment, as its author or an authorized manager. Irreversible: asks the user to confirm. Needs the current comment version.",
    inputSchema: DeleteComment,
    annotations: DESTRUCTIVE,
    scopes: write,
  })
  async deleteComment(
    { commentId, version: current, confirm: ok }: Input<typeof DeleteComment>,
    ctx: McpContext,
  ) {
    const decision = requireConfirmation(ctx, ok, "Delete this comment permanently?");
    if (decision.status === "pending") return decision.result;
    if (decision.status === "declined") return decision.message;
    return this.api.request(ctx, "projects", `/comments/${commentId}`, {
      method: "DELETE",
      query: { version: current },
    });
  }
}
