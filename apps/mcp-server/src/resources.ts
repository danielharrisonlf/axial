import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { type McpContext, Resource, ResourceTemplate } from "@nestjs/mcp";
import { z } from "zod";
import { boardMarkdown } from "./format.js";
import { CallerIdentity } from "./identity.js";
import { McpPrimitives } from "./mcp/primitives.js";
import type { Project, Sprint, Task } from "./schemas.js";
import { SCOPES } from "./scopes.js";
import { AxialApi, type Page } from "./upstream.js";

const read = [SCOPES.projectsRead];

function uuidVariable(name: string, value: string | string[] | undefined): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new BadRequestException(`${name} must be a UUID`);
  return parsed.data;
}

/** Read-only context an agent can attach without calling tools: identity, projects, boards, tasks, sprints. */
@Injectable()
@McpPrimitives()
export class AxialResources {
  constructor(
    @Inject(AxialApi) private readonly api: AxialApi,
    @Inject(CallerIdentity) private readonly identity: CallerIdentity,
  ) {}

  @Resource({
    uri: "axial://me",
    name: "me",
    title: "Signed-in identity",
    description:
      "Who the agent acts as: user id, organization, role, team and project claims, granted MCP scopes and token expiry. Everything else is limited to this identity.",
    mimeType: "application/json",
  })
  async me(_input: unknown, ctx: McpContext) {
    const identity = await this.identity.resolve(ctx);
    return {
      userId: identity.userId,
      organizationId: identity.organizationId,
      role: identity.role,
      source: identity.source,
      teamIds: identity.teamIds,
      projectIds: identity.projectIds,
      scopes: identity.scopes,
      expiresAt: new Date(identity.expiresAt * 1000).toISOString(),
      transport: ctx.transport,
    };
  }

  @Resource({
    uri: "axial://projects",
    name: "projects",
    title: "Accessible projects",
    description:
      "JSON list of up to 100 active projects the signed-in user can see (same data as list-projects).",
    mimeType: "application/json",
    scopes: read,
  })
  projects(_input: unknown, ctx: McpContext) {
    return this.api.get(ctx, "projects", "/projects", { pageSize: 100 });
  }

  @ResourceTemplate({
    uriTemplate: "axial://projects/{projectId}",
    name: "project",
    title: "Project overview",
    description: "JSON overview of a project: the project, its delivery summary, sprints and milestones.",
    mimeType: "application/json",
    scopes: read,
  })
  async project({ projectId }: { projectId: string }, ctx: McpContext) {
    const idValue = uuidVariable("projectId", projectId);
    const [project, summary, sprints, milestones] = await Promise.all([
      this.api.get(ctx, "projects", `/projects/${idValue}`),
      this.api.get(ctx, "projects", `/projects/${idValue}/summary`),
      this.api.get(ctx, "projects", `/projects/${idValue}/sprints`, { pageSize: 100 }),
      this.api.get(ctx, "projects", `/projects/${idValue}/milestones`, { pageSize: 100 }),
    ]);
    return { project, summary, sprints, milestones };
  }

  @ResourceTemplate({
    uriTemplate: "axial://projects/{projectId}/board",
    name: "board",
    title: "Kanban board",
    description:
      "The project's Kanban board as Markdown: each column with its tasks (up to 100 per column), assignee, estimate, due date, overdue and open-blocker flags.",
    mimeType: "text/markdown",
    scopes: read,
  })
  async board({ projectId }: { projectId: string }, ctx: McpContext) {
    const idValue = uuidVariable("projectId", projectId);
    const [project, board] = await Promise.all([
      this.api.get<Project>(ctx, "projects", `/projects/${idValue}`),
      this.api.get<{ columns: Array<Page<Task> & { status: string }> }>(
        ctx,
        "projects",
        `/projects/${idValue}/board`,
        { pageSize: 100 },
      ),
    ]);
    return boardMarkdown(project, board.columns);
  }

  @ResourceTemplate({
    uriTemplate: "axial://tasks/{taskId}",
    name: "task",
    title: "Task",
    description: "JSON of a task with its subtasks and up to 100 comments.",
    mimeType: "application/json",
    scopes: read,
  })
  async task({ taskId }: { taskId: string }, ctx: McpContext) {
    const idValue = uuidVariable("taskId", taskId);
    const task = await this.api.get<Task>(ctx, "projects", `/tasks/${idValue}`);
    const [subtasks, comments] = await Promise.all([
      this.api.get(ctx, "projects", `/projects/${task.projectId}/tasks`, {
        parentId: idValue,
        pageSize: 100,
      }),
      this.api.get(ctx, "projects", `/tasks/${idValue}/comments`, { pageSize: 100 }),
    ]);
    return { task, subtasks, comments };
  }

  @ResourceTemplate({
    uriTemplate: "axial://sprints/{sprintId}",
    name: "sprint",
    title: "Sprint",
    description: "JSON of a sprint with its tasks (up to 500) and done/total counts.",
    mimeType: "application/json",
    scopes: read,
  })
  async sprint({ sprintId }: { sprintId: string }, ctx: McpContext) {
    const idValue = uuidVariable("sprintId", sprintId);
    const sprint = await this.api.get<Sprint>(ctx, "projects", `/sprints/${idValue}`);
    const tasks = await this.api.collect<Task>(ctx, `/projects/${sprint.projectId}/tasks`, {
      sprintId: idValue,
    });
    return {
      sprint,
      progress: {
        total: tasks.total,
        done: tasks.items.filter((task) => task.status === "done").length,
        truncated: tasks.truncated,
      },
      tasks: tasks.items,
    };
  }
}
