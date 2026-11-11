import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { type McpContext, Tool } from "@nestjs/mcp";
import { z } from "zod";
import { readConfig } from "./config.js";
import { compact, queryString, upstreamError } from "./upstream.js";

const status = z.enum(["backlog", "todo", "in_progress", "in_review", "done"]);
const priority = z.enum(["low", "medium", "high", "urgent"]);

@Injectable()
export class ProjectsApi {
  private readonly baseUrl: string;
  constructor(baseUrl = readConfig().PROJECTS_API_URL) {
    this.baseUrl = baseUrl;
  }

  async request(ctx: McpContext, path: string, init: RequestInit = {}): Promise<unknown> {
    const token = (ctx.authInfo?.extra as { token?: unknown } | undefined)?.token;
    if (typeof token !== "string") throw new UnauthorizedException("Missing access token");
    const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15_000)]),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) throw upstreamError(response.status, body);
    return body;
  }
}

/** Tools inherit the caller's token; ms-projects remains the authorization boundary. */
@Injectable()
export class ProjectTools {
  constructor(@Inject(ProjectsApi) private readonly projects: ProjectsApi) {}

  @Tool({
    name: "list-projects",
    description:
      "List the projects the caller can see. Use it to find a project id before reading its tasks or sprints.",
    inputSchema: z.object({
      search: z.string().max(160).optional().describe("Text matched against project name and key"),
      page: z.number().int().positive().optional().describe("Page number, starting at 1"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Items per page, at most 100"),
    }),
    annotations: { readOnlyHint: true },
  })
  listProjects(
    input: { search?: string; page?: number; pageSize?: number },
    ctx: McpContext,
  ): Promise<unknown> {
    return this.projects.request(ctx, `/projects${queryString(input)}`);
  }

  @Tool({
    name: "get-project",
    description: "Read one project by id, including its status, dates and delivery summary.",
    inputSchema: z.object({ projectId: z.uuid().describe("The project id") }),
    annotations: { readOnlyHint: true },
  })
  getProject({ projectId }: { projectId: string }, ctx: McpContext): Promise<unknown> {
    return this.projects.request(ctx, `/projects/${projectId}`);
  }

  @Tool({
    name: "project-summary",
    description: "Read the task and sprint summary of a project.",
    inputSchema: z.object({ projectId: z.uuid().describe("The project id") }),
    annotations: { readOnlyHint: true },
  })
  projectSummary({ projectId }: { projectId: string }, ctx: McpContext): Promise<unknown> {
    return this.projects.request(ctx, `/projects/${projectId}/summary`);
  }

  @Tool({
    name: "list-tasks",
    description: "List tasks of a project, optionally filtered by status, assignee or text.",
    inputSchema: z.object({
      projectId: z.uuid().describe("The project id"),
      status: status.optional().describe("Kanban status"),
      assigneeId: z.uuid().optional().describe("Only tasks assigned to this user"),
      search: z.string().max(240).optional().describe("Text matched against task title and reference"),
      page: z.number().int().positive().optional().describe("Page number, starting at 1"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Items per page, at most 100"),
    }),
    annotations: { readOnlyHint: true },
  })
  listTasks(
    input: {
      projectId: string;
      status?: string;
      assigneeId?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
    ctx: McpContext,
  ): Promise<unknown> {
    const { projectId, ...filters } = input;
    return this.projects.request(ctx, `/projects/${projectId}/tasks${queryString(filters)}`);
  }

  @Tool({
    name: "get-task",
    description: "Read one task by id, including its description, labels and dependencies.",
    inputSchema: z.object({ taskId: z.uuid().describe("The task id") }),
    annotations: { readOnlyHint: true },
  })
  getTask({ taskId }: { taskId: string }, ctx: McpContext): Promise<unknown> {
    return this.projects.request(ctx, `/tasks/${taskId}`);
  }

  @Tool({
    name: "create-task",
    description:
      "Create a task in a project. This changes data; confirm the project and title with the user before calling it.",
    inputSchema: z.object({
      projectId: z.uuid().describe("The project that will own the task"),
      title: z.string().trim().min(1).max(240).describe("Short task title"),
      description: z.string().max(20_000).optional().describe("Markdown description"),
      status: status.optional().describe("Initial Kanban status; defaults to backlog"),
      priority: priority.optional().describe("Task priority; defaults to medium"),
      assigneeId: z.uuid().nullable().optional().describe("User id to assign, or null"),
      dueDate: z.iso
        .datetime({ offset: true })
        .nullable()
        .optional()
        .describe("Due date as an ISO 8601 timestamp, or null"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  })
  createTask(
    input: {
      projectId: string;
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      assigneeId?: string | null;
      dueDate?: string | null;
    },
    ctx: McpContext,
  ): Promise<unknown> {
    const { projectId, ...body } = input;
    return this.projects.request(ctx, `/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(compact(body)),
    });
  }

  @Tool({
    name: "update-task-status",
    description:
      "Move a task to another Kanban status. This changes data and needs the current task version.",
    inputSchema: z.object({
      taskId: z.uuid().describe("The task id"),
      status: status.describe("The new Kanban status"),
      version: z.number().int().positive().describe("The task version returned by get-task"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  })
  updateTaskStatus(
    input: { taskId: string; status: string; version: number },
    ctx: McpContext,
  ): Promise<unknown> {
    const { taskId, ...body } = input;
    return this.projects.request(ctx, `/tasks/${taskId}/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  @Tool({
    name: "list-sprints",
    description: "List the sprints of a project with their status and date range.",
    inputSchema: z.object({ projectId: z.uuid().describe("The project id") }),
    annotations: { readOnlyHint: true },
  })
  listSprints({ projectId }: { projectId: string }, ctx: McpContext): Promise<unknown> {
    return this.projects.request(ctx, `/projects/${projectId}/sprints`);
  }
}
