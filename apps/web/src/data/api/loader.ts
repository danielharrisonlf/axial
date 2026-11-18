import { z } from "zod";
import { ApiError, fetchAllPages, type HttpClient } from "./http";
import {
  type ApiAuditEvent,
  type ApiComment,
  type ApiEpic,
  type ApiMe,
  type ApiMember,
  type ApiMilestone,
  type ApiProject,
  type ApiSprint,
  type ApiTask,
  type ApiTeam,
  apiAuditEventSchema,
  apiCommentSchema,
  apiEpicSchema,
  apiMemberSchema,
  apiMeSchema,
  apiMilestoneSchema,
  apiProjectSchema,
  apiSprintSchema,
  apiTaskSchema,
  apiTeamSchema,
} from "./mappers";

/**
 * Reads what the Workspace keeps in memory for one organization. Every list is read to the end
 * (pages of 100); the services scope rows to the projects the token can read.
 */

const pageOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), total: z.number().int() });

function listAll<T extends z.ZodType>(
  http: HttpClient,
  path: string,
  item: T,
  query: Record<string, string> = {},
): Promise<z.infer<T>[]> {
  const schema = pageOf(item);
  return fetchAllPages(async (page, pageSize) =>
    schema.parse(await http.request<unknown>(path, { query: { ...query, page, pageSize } })),
  );
}

/** Latest audit entries shown by Insights and the dashboard (the full trail stays in ms-audit). */
export const AUDIT_PAGES = 3;

export interface WorkspacePayload {
  me: ApiMe;
  members: ApiMember[];
  teams: ApiTeam[];
  projects: ApiProject[];
  epics: ApiEpic[];
  sprints: ApiSprint[];
  milestones: ApiMilestone[];
  tasks: ApiTask[];
  /** null when the role cannot read the audit trail. */
  audit: ApiAuditEvent[] | null;
}

export async function loadAudit(
  http: HttpClient,
  query: Record<string, string> = {},
  pages = AUDIT_PAGES,
): Promise<ApiAuditEvent[]> {
  const schema = pageOf(apiAuditEventSchema);
  const out: ApiAuditEvent[] = [];
  for (let page = 1; page <= pages; page++) {
    const result = schema.parse(
      await http.request<unknown>("/audit", { query: { ...query, page, pageSize: 100 } }),
    );
    out.push(...result.items);
    if (page * 100 >= result.total) break;
  }
  return out;
}

export async function loadWorkspace(
  http: HttpClient,
  options: { audit: boolean },
): Promise<WorkspacePayload> {
  const [me, members, teams, active, archived, epics, sprints, milestones, tasks, audit] = await Promise.all([
    http.request<unknown>("/me").then((raw) => apiMeSchema.parse(raw)),
    http.request<unknown>("/organization/members").then((raw) => z.array(apiMemberSchema).parse(raw)),
    http.request<unknown>("/organization/teams").then((raw) => z.array(apiTeamSchema).parse(raw)),
    listAll(http, "/projects", apiProjectSchema, { archived: "false" }),
    listAll(http, "/projects", apiProjectSchema, { archived: "true" }),
    listAll(http, "/epics", apiEpicSchema),
    listAll(http, "/sprints", apiSprintSchema),
    listAll(http, "/milestones", apiMilestoneSchema),
    listAll(http, "/tasks", apiTaskSchema),
    options.audit
      ? loadAudit(http).catch((error: unknown) => {
          // the role may lose audit access between token and call: the trail is just not shown
          if (error instanceof ApiError && error.status === 403) return null;
          throw error;
        })
      : Promise.resolve(null),
  ]);
  return { me, members, teams, projects: [...active, ...archived], epics, sprints, milestones, tasks, audit };
}

export interface ProjectPayload {
  project: ApiProject;
  epics: ApiEpic[];
  sprints: ApiSprint[];
  milestones: ApiMilestone[];
  tasks: ApiTask[];
}

/** One project and its children, after a realtime invalidation or a write conflict. */
export async function loadProject(http: HttpClient, projectId: string): Promise<ProjectPayload> {
  const scope = { projectId };
  const [project, epics, sprints, milestones, tasks] = await Promise.all([
    http.request<unknown>(`/projects/${projectId}`).then((raw) => apiProjectSchema.parse(raw)),
    listAll(http, "/epics", apiEpicSchema, scope),
    listAll(http, "/sprints", apiSprintSchema, scope),
    listAll(http, "/milestones", apiMilestoneSchema, scope),
    listAll(http, "/tasks", apiTaskSchema, scope),
  ]);
  return { project, epics, sprints, milestones, tasks };
}

export function loadComments(http: HttpClient, taskId: string): Promise<ApiComment[]> {
  return listAll(http, `/tasks/${taskId}/comments`, apiCommentSchema);
}
