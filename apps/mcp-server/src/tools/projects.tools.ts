import { Inject, Injectable } from "@nestjs/common";
import { type McpContext, Tool } from "@nestjs/mcp";
import { z } from "zod";
import { requireConfirmation } from "../mcp/confirmation.js";
import { McpPrimitives } from "../mcp/primitives.js";
import {
  confirm,
  DESTRUCTIVE,
  epicFields,
  epicOut,
  id,
  milestoneFields,
  page,
  pageOf,
  pageSize,
  priority,
  projectFields,
  projectOut,
  projectStatus,
  READ_ONLY,
  summaryOut,
  taskStatus,
  version,
  WRITE,
  WRITE_IDEMPOTENT,
} from "../schemas.js";
import { READ_SCOPE, WRITE_SCOPE } from "../scopes.js";
import { AxialApi } from "../upstream.js";

const read = [READ_SCOPE];
const write = [WRITE_SCOPE];

const ListProjects = z.object({
  search: z.string().max(160).optional().describe("Text matched against project name and key"),
  status: projectStatus.optional(),
  archived: z.boolean().optional().describe("true lists only archived projects; default false (active ones)"),
  page,
  pageSize,
});
const ProjectId = z.object({ projectId: id("Project id (from list-projects)") });
const CreateProject = z.object(projectFields);
const UpdateProject = z.object({
  projectId: id("Project id"),
  version: version("project"),
  name: projectFields.name.optional(),
  description: projectFields.description,
  color: projectFields.color,
  priority: projectFields.priority,
  status: projectStatus.optional(),
  leadId: projectFields.leadId,
  teamIds: projectFields.teamIds,
  startDate: projectFields.startDate,
  endDate: projectFields.endDate,
});
const ArchiveProject = z.object({ projectId: id("Project id"), version: version("project"), confirm });
const RestoreProject = z.object({ projectId: id("Project id"), version: version("project") });
const ProjectPage = z.object({ projectId: id("Project id"), page, pageSize });
const AcrossProjects = z.object({
  projectId: z
    .uuid()
    .optional()
    .describe("Only this project; omit to list across every project the caller can read"),
  page,
  pageSize,
});
const ProjectTaskFilters = z.object({
  projectId: id("Project id"),
  search: z.string().max(240).optional().describe("Text matched against task title and reference"),
  priority: priority.optional(),
  assigneeId: z.uuid().optional().describe("Only tasks assigned to this user"),
  teamId: z.uuid().optional().describe("Only tasks of this team"),
  epicId: z.uuid().optional().describe("Only tasks of this epic"),
  sprintId: z.uuid().optional().describe("Only tasks of this sprint"),
  label: z.string().max(40).optional().describe("Only tasks carrying this label"),
  page,
  pageSize: pageSize.describe("Items per page and per column, 1 to 100 (default 25)"),
});
const EpicId = z.object({ epicId: id("Epic id") });
const CreateEpic = z.object({ projectId: id("Project that will own the epic"), ...epicFields });
const UpdateEpic = z.object({
  epicId: id("Epic id"),
  version: version("epic"),
  title: epicFields.title.optional(),
  description: epicFields.description,
  ownerId: epicFields.ownerId,
  status: taskStatus.optional(),
});
const DeleteEpic = z.object({ epicId: id("Epic id"), version: version("epic"), confirm });
const MilestoneId = z.object({ milestoneId: id("Milestone id") });
const CreateMilestone = z.object({ projectId: id("Project id"), ...milestoneFields });
const UpdateMilestone = z.object({
  milestoneId: id("Milestone id"),
  version: version("milestone"),
  name: milestoneFields.name.optional(),
  date: milestoneFields.date.optional(),
  completed: z.boolean().optional().describe("true marks the milestone completed, false reopens it"),
});
const DeleteMilestone = z.object({ milestoneId: id("Milestone id"), version: version("milestone"), confirm });

type Input<T extends z.ZodType> = z.infer<T>;

/** Projects, their projections (summary, board, backlog, timeline), epics and milestones. */
@Injectable()
@McpPrimitives()
export class ProjectTools {
  constructor(@Inject(AxialApi) private readonly api: AxialApi) {}

  @Tool({
    name: "list-projects",
    title: "List projects",
    description:
      "List the projects the signed-in user can see in their organization, newest first. Start here to find a project id. Returns {items,total,page,pageSize}; each project carries its version for later updates.",
    inputSchema: ListProjects,
    outputSchema: pageOf(projectOut),
    annotations: READ_ONLY,
    scopes: read,
  })
  listProjects({ archived, ...input }: Input<typeof ListProjects>, ctx: McpContext) {
    return this.api.get(ctx, "projects", "/projects", {
      ...input,
      ...(archived === undefined ? {} : { archived: String(archived) }),
    });
  }

  @Tool({
    name: "get-project",
    title: "Get project",
    description:
      "Read one project: key, color, status, priority, lead, teams, dates, archive state and current version.",
    inputSchema: ProjectId,
    outputSchema: projectOut,
    annotations: READ_ONLY,
    scopes: read,
  })
  getProject({ projectId }: Input<typeof ProjectId>, ctx: McpContext) {
    return this.api.get(ctx, "projects", `/projects/${projectId}`);
  }

  @Tool({
    name: "project-summary",
    title: "Project summary",
    description:
      "Delivery indicators of a project: top-level task counts by status, overdue tasks, completion percent and estimated/completed points (subtasks are excluded to avoid double counting).",
    inputSchema: ProjectId,
    outputSchema: summaryOut,
    annotations: READ_ONLY,
    scopes: read,
  })
  projectSummary({ projectId }: Input<typeof ProjectId>, ctx: McpContext) {
    return this.api.get(ctx, "projects", `/projects/${projectId}/summary`);
  }

  @Tool({
    name: "get-board",
    title: "Kanban board",
    description:
      "Read the Kanban board of a project: one column per status (backlog, todo, in_progress, in_review, done), each paginated on its own with the same filters. Use it to see work in progress at a glance.",
    inputSchema: ProjectTaskFilters,
    annotations: READ_ONLY,
    scopes: read,
  })
  board({ projectId, ...filters }: Input<typeof ProjectTaskFilters>, ctx: McpContext) {
    return this.api.get(ctx, "projects", `/projects/${projectId}/board`, filters);
  }

  @Tool({
    name: "list-backlog",
    title: "List backlog",
    description:
      "List the backlog of a project: unfinished tasks that are in no sprint, whatever their status. Use it to pick tasks for sprint planning.",
    inputSchema: ProjectTaskFilters,
    annotations: READ_ONLY,
    scopes: read,
  })
  backlog({ projectId, ...filters }: Input<typeof ProjectTaskFilters>, ctx: McpContext) {
    return this.api.get(ctx, "projects", `/projects/${projectId}/backlog`, filters);
  }

  @Tool({
    name: "get-timeline",
    title: "Project timeline",
    description:
      "Read the dated items of a project: tasks with start or due dates, sprints and milestones, each collection paginated separately.",
    inputSchema: ProjectPage,
    annotations: READ_ONLY,
    scopes: read,
  })
  timeline({ projectId, ...query }: Input<typeof ProjectPage>, ctx: McpContext) {
    return this.api.get(ctx, "projects", `/projects/${projectId}/timeline`, query);
  }

  @Tool({
    name: "create-project",
    title: "Create project",
    description:
      "Create a project in the caller's organization (managers only). The key is immutable and unique in the organization. Confirm key and name with the user first.",
    inputSchema: CreateProject,
    annotations: WRITE,
    scopes: write,
  })
  createProject(input: Input<typeof CreateProject>, ctx: McpContext) {
    return this.api.request(ctx, "projects", "/projects", { method: "POST", body: input });
  }

  @Tool({
    name: "update-project",
    title: "Update project",
    description:
      "Change project fields (name, description, color, priority, status, lead, teams, dates). Omitted fields are kept; null clears a nullable field. Needs the version from the latest read; a conflict means someone changed it in between.",
    inputSchema: UpdateProject,
    annotations: WRITE_IDEMPOTENT,
    scopes: write,
  })
  updateProject({ projectId, ...body }: Input<typeof UpdateProject>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/projects/${projectId}`, { method: "PATCH", body });
  }

  @Tool({
    name: "archive-project",
    title: "Archive project",
    description:
      "Archive a project: it leaves the active lists and rejects every change until restored with restore-project. Asks the user to confirm.",
    inputSchema: ArchiveProject,
    annotations: DESTRUCTIVE,
    scopes: write,
  })
  async archiveProject(
    { projectId, version: current, confirm: ok }: Input<typeof ArchiveProject>,
    ctx: McpContext,
  ) {
    const project = await this.api.get<{ key: string; name: string }>(
      ctx,
      "projects",
      `/projects/${projectId}`,
    );
    const decision = requireConfirmation(
      ctx,
      ok,
      `Archive project ${project.key} — ${project.name}? It will reject changes until restored.`,
    );
    if (decision.status === "pending") return decision.result;
    if (decision.status === "declined") return decision.message;
    return this.api.request(ctx, "projects", `/projects/${projectId}/archive`, {
      method: "POST",
      body: { version: current },
    });
  }

  @Tool({
    name: "restore-project",
    title: "Restore project",
    description:
      "Restore an archived project so it accepts changes again. Needs the current project version.",
    inputSchema: RestoreProject,
    annotations: WRITE,
    scopes: write,
  })
  restoreProject({ projectId, ...body }: Input<typeof RestoreProject>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/projects/${projectId}/restore`, { method: "POST", body });
  }

  @Tool({
    name: "list-epics",
    title: "List epics",
    description:
      "List epics with their project, status, owner and version: of one project, or across every project the caller can read when projectId is omitted.",
    inputSchema: AcrossProjects,
    outputSchema: pageOf(epicOut),
    annotations: READ_ONLY,
    scopes: read,
  })
  listEpics(query: Input<typeof AcrossProjects>, ctx: McpContext) {
    return this.api.get(ctx, "projects", "/epics", query);
  }

  @Tool({
    name: "get-epic",
    title: "Get epic",
    description: "Read one epic. Use list-tasks with epicId to see its tasks.",
    inputSchema: EpicId,
    outputSchema: epicOut,
    annotations: READ_ONLY,
    scopes: read,
  })
  getEpic({ epicId }: Input<typeof EpicId>, ctx: McpContext) {
    return this.api.get(ctx, "projects", `/epics/${epicId}`);
  }

  @Tool({
    name: "create-epic",
    title: "Create epic",
    description: "Create an epic in a project to group related tasks.",
    inputSchema: CreateEpic,
    annotations: WRITE,
    scopes: write,
  })
  createEpic({ projectId, ...body }: Input<typeof CreateEpic>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/projects/${projectId}/epics`, { method: "POST", body });
  }

  @Tool({
    name: "update-epic",
    title: "Update epic",
    description: "Change an epic's title, description, owner or status. Needs the current epic version.",
    inputSchema: UpdateEpic,
    annotations: WRITE_IDEMPOTENT,
    scopes: write,
  })
  updateEpic({ epicId, ...body }: Input<typeof UpdateEpic>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/epics/${epicId}`, { method: "PATCH", body });
  }

  @Tool({
    name: "delete-epic",
    title: "Delete epic",
    description:
      "Delete an epic that no task references. Irreversible: asks the user to confirm. Needs the current epic version.",
    inputSchema: DeleteEpic,
    annotations: DESTRUCTIVE,
    scopes: write,
  })
  async deleteEpic({ epicId, version: current, confirm: ok }: Input<typeof DeleteEpic>, ctx: McpContext) {
    const epic = await this.api.get<{ title: string }>(ctx, "projects", `/epics/${epicId}`);
    const decision = requireConfirmation(ctx, ok, `Delete epic "${epic.title}" permanently?`);
    if (decision.status === "pending") return decision.result;
    if (decision.status === "declined") return decision.message;
    return this.api.request(ctx, "projects", `/epics/${epicId}`, {
      method: "DELETE",
      query: { version: current },
    });
  }

  @Tool({
    name: "list-milestones",
    title: "List milestones",
    description:
      "List dated milestones, oldest first, with completion and version: of one project, or across every project the caller can read when projectId is omitted.",
    inputSchema: AcrossProjects,
    annotations: READ_ONLY,
    scopes: read,
  })
  listMilestones(query: Input<typeof AcrossProjects>, ctx: McpContext) {
    return this.api.get(ctx, "projects", "/milestones", query);
  }

  @Tool({
    name: "get-milestone",
    title: "Get milestone",
    description: "Read one milestone: name, date, completion and current version.",
    inputSchema: MilestoneId,
    annotations: READ_ONLY,
    scopes: read,
  })
  getMilestone({ milestoneId }: Input<typeof MilestoneId>, ctx: McpContext) {
    return this.api.get(ctx, "projects", `/milestones/${milestoneId}`);
  }

  @Tool({
    name: "create-milestone",
    title: "Create milestone",
    description: "Create a dated milestone in a project.",
    inputSchema: CreateMilestone,
    annotations: WRITE,
    scopes: write,
  })
  createMilestone({ projectId, ...body }: Input<typeof CreateMilestone>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/projects/${projectId}/milestones`, { method: "POST", body });
  }

  @Tool({
    name: "update-milestone",
    title: "Update milestone",
    description: "Rename, reschedule, complete or reopen a milestone. Needs the current milestone version.",
    inputSchema: UpdateMilestone,
    annotations: WRITE_IDEMPOTENT,
    scopes: write,
  })
  updateMilestone({ milestoneId, ...body }: Input<typeof UpdateMilestone>, ctx: McpContext) {
    return this.api.request(ctx, "projects", `/milestones/${milestoneId}`, { method: "PATCH", body });
  }

  @Tool({
    name: "delete-milestone",
    title: "Delete milestone",
    description:
      "Delete a milestone. Irreversible: asks the user to confirm. Needs the current milestone version.",
    inputSchema: DeleteMilestone,
    annotations: DESTRUCTIVE,
    scopes: write,
  })
  async deleteMilestone(
    { milestoneId, version: current, confirm: ok }: Input<typeof DeleteMilestone>,
    ctx: McpContext,
  ) {
    const milestone = await this.api.get<{ name: string }>(ctx, "projects", `/milestones/${milestoneId}`);
    const decision = requireConfirmation(ctx, ok, `Delete milestone "${milestone.name}" permanently?`);
    if (decision.status === "pending") return decision.result;
    if (decision.status === "declined") return decision.message;
    return this.api.request(ctx, "projects", `/milestones/${milestoneId}`, {
      method: "DELETE",
      query: { version: current },
    });
  }
}
