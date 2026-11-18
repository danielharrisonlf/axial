import { type Role, roleSchema } from "@axial/contracts";
import { z } from "zod";
import { CAT_HEX, PRIO_META, ROLE_LABEL, STATUS_META, ymd } from "../../lib/format";
import type {
  AuditEntry,
  Comment,
  Epic,
  Milestone,
  Organization,
  Priority,
  Project,
  RoleId,
  Sprint,
  Task,
  TaskStatus,
  Team,
  User,
} from "../types";

/**
 * Wire formats of the services (validated on arrival, so a contract drift fails loudly instead
 * of drawing wrong data) and their mapping to the Workspace model of the prototype:
 * description → desc, endDate → targetDate, archivedAt → archived, epic title → name,
 * dependencies → blockedBy, completedAt → doneAt / milestone status, acceptanceCriteria → acceptance.
 * Calendar fields of the interface ("AAAA-MM-DD", local day) travel as ISO instants: start of the
 * local day for starts, end of the local day for due dates, sprint and project ends and milestones.
 */

const id = z.string().min(1);
const instant = z.string().min(1);
const nullableInstant = instant.nullable();
const priority = z.enum(["low", "medium", "high", "urgent"]);
const taskStatus = z.enum(["backlog", "todo", "in_progress", "in_review", "done"]);

export const apiProjectSchema = z.object({
  id,
  organizationId: id,
  key: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string().nullable(),
  status: z.enum(["active", "paused", "done"]),
  priority,
  leadId: id.nullable(),
  teamIds: z.array(id),
  startDate: nullableInstant,
  endDate: nullableInstant,
  archivedAt: nullableInstant,
  version: z.number().int(),
  createdAt: instant,
});
export const apiEpicSchema = z.object({
  id,
  projectId: id,
  title: z.string(),
  description: z.string(),
  status: z.string(),
  ownerId: id.nullable(),
  version: z.number().int(),
});
export const apiSprintSchema = z.object({
  id,
  projectId: id,
  name: z.string(),
  goal: z.string(),
  status: z.enum(["planned", "active", "done"]),
  startDate: instant,
  endDate: instant,
  version: z.number().int(),
});
export const apiMilestoneSchema = z.object({
  id,
  projectId: id,
  name: z.string(),
  date: instant,
  completedAt: nullableInstant,
  version: z.number().int(),
});
export const apiTaskSchema = z.object({
  id,
  projectId: id,
  ref: z.string(),
  title: z.string(),
  description: z.string(),
  type: z.enum(["task", "bug", "subtask"]),
  status: taskStatus,
  priority,
  assigneeId: id.nullable(),
  teamId: id.nullable(),
  epicId: id.nullable(),
  sprintId: id.nullable(),
  parentId: id.nullable(),
  labels: z.array(z.string()),
  acceptanceCriteria: z.array(z.object({ text: z.string(), done: z.boolean() })),
  dueDate: nullableInstant,
  completedAt: nullableInstant,
  createdBy: id,
  createdAt: instant,
  updatedAt: instant,
  version: z.number().int(),
  dependencies: z.array(z.object({ dependsOnId: id })).default([]),
});
export const apiCommentSchema = z.object({
  id,
  taskId: id,
  authorId: id,
  body: z.string(),
  createdAt: instant,
  version: z.number().int(),
});
export const apiMemberSchema = z.object({
  id,
  name: z.string(),
  email: z.string(),
  title: z.string().nullable(),
  role: roleSchema,
  active: z.boolean(),
  teamIds: z.array(id),
});
export const apiTeamSchema = z.object({
  id,
  name: z.string(),
  description: z.string().nullable(),
  leadUserId: id.nullable(),
  memberIds: z.array(id),
  active: z.boolean(),
});
export const apiMeSchema = z.object({
  userId: id,
  organizationId: id,
  role: roleSchema,
  name: z.string(),
  email: z.string(),
  title: z.string().nullable(),
  memberships: z.array(z.object({ organizationId: id, organizationName: z.string(), role: roleSchema })),
});
export const apiAuditEventSchema = z.object({
  id,
  projectId: id.nullable(),
  eventType: z.string(),
  aggregateType: z.string(),
  aggregateId: id,
  actorId: id,
  actorSource: z.string(),
  occurredAt: instant,
  data: z.object({ before: z.unknown().optional(), after: z.unknown().optional() }).nullable().optional(),
});
export const apiInvitationSchema = z.object({
  id,
  email: z.string(),
  role: roleSchema,
  teamIds: z.array(id),
  title: z.string().nullable(),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  expiresAt: instant,
  createdAt: instant,
});
export type ApiProject = z.infer<typeof apiProjectSchema>;
export type ApiEpic = z.infer<typeof apiEpicSchema>;
export type ApiSprint = z.infer<typeof apiSprintSchema>;
export type ApiMilestone = z.infer<typeof apiMilestoneSchema>;
export type ApiTask = z.infer<typeof apiTaskSchema>;
export type ApiComment = z.infer<typeof apiCommentSchema>;
export type ApiMember = z.infer<typeof apiMemberSchema>;
export type ApiTeam = z.infer<typeof apiTeamSchema>;
export type ApiMe = z.infer<typeof apiMeSchema>;
export type ApiAuditEvent = z.infer<typeof apiAuditEventSchema>;
export type ApiInvitation = z.infer<typeof apiInvitationSchema>;

const ROLE_ID: Record<Role, RoleId> = {
  ADMIN: "admin",
  PROJECT_MANAGER: "pm",
  TEAM_LEAD: "lead",
  CONTRIBUTOR: "dev",
  VIEWER: "viewer",
};
const API_ROLE: Record<RoleId, Role> = {
  admin: "ADMIN",
  pm: "PROJECT_MANAGER",
  lead: "TEAM_LEAD",
  dev: "CONTRIBUTOR",
  viewer: "VIEWER",
};
export const toRoleId = (role: Role): RoleId => ROLE_ID[role];
export const toApiRole = (roleId: RoleId): Role => API_ROLE[roleId];
const ROLE_DESC: Record<RoleId, string> = {
  admin: "Configuração da empresa, usuários, convites e auditoria.",
  pm: "Gerencia todos os projetos, sprints, tarefas e indicadores da empresa.",
  lead: "Gerencia projetos, tarefas e sprints das próprias equipes.",
  dev: "Vê projetos autorizados e trabalha nas tarefas atribuídas a si.",
  viewer: "Acesso de leitura a projetos, tarefas e relatórios.",
};
/** The five roles with the interface names; the ms-projects policy decides what each one may do. */
export const API_ROLES = (Object.keys(API_ROLE) as RoleId[]).map((roleId) => ({
  id: roleId,
  name: ROLE_LABEL[roleId],
  desc: ROLE_DESC[roleId],
}));

/** ISO instant → local calendar day ("AAAA-MM-DD"). */
export function toLocalDay(value: string): string;
export function toLocalDay(value: string | null): string | null;
export function toLocalDay(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Data inválida recebida da API: ${value}`);
  return ymd(date);
}
/** Local calendar day → ISO instant at the start or the end of that day in this browser's time zone. */
export function fromLocalDay(day: string, edge: "start" | "end"): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) throw new Error(`Data inválida: ${day}`);
  const local =
    edge === "start"
      ? new Date(year, month - 1, date, 0, 0, 0, 0)
      : new Date(year, month - 1, date, 23, 59, 59, 999);
  return local.toISOString();
}
export const fromLocalDayOrNull = (day: string | null | undefined, edge: "start" | "end") =>
  day ? fromLocalDay(day, edge) : null;

/** Stable categorical color per person (the avatar uses the themed token for this hex). */
export function colorFor(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return CAT_HEX[hash % CAT_HEX.length] ?? "#2B5FD9";
}
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

export function mapProject(row: ApiProject): Project {
  const startDate = toLocalDay(row.startDate) ?? toLocalDay(row.createdAt);
  return {
    id: row.id,
    orgId: row.organizationId,
    key: row.key,
    name: row.name,
    desc: row.description,
    teamIds: row.teamIds,
    leadId: row.leadId ?? "",
    priority: row.priority,
    status: row.status,
    startDate,
    targetDate: toLocalDay(row.endDate),
    archived: row.archivedAt !== null,
    createdAt: row.createdAt,
    color: row.color ?? colorFor(row.key),
  };
}
export function mapEpic(row: ApiEpic): Epic {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.title,
    desc: row.description,
    // the prototype knows "active" and "done"; every open status of the service is "active"
    status: row.status === "done" ? "done" : "active",
    ownerId: row.ownerId ?? "",
  };
}
export function mapSprint(row: ApiSprint): Sprint {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    goal: row.goal,
    status: row.status,
    startDate: toLocalDay(row.startDate),
    endDate: toLocalDay(row.endDate),
  };
}
export function mapMilestone(row: ApiMilestone): Milestone {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    date: toLocalDay(row.date),
    status: row.completedAt ? "done" : "open",
  };
}
export function mapTask(row: ApiTask): Task {
  return {
    id: row.id,
    ref: row.ref,
    projectId: row.projectId,
    epicId: row.epicId,
    parentId: row.parentId,
    type: row.type,
    title: row.title,
    desc: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assigneeId,
    teamId: row.teamId,
    sprintId: row.sprintId,
    labels: row.labels,
    acceptance: row.acceptanceCriteria.map((criterion) => ({ text: criterion.text, done: criterion.done })),
    blockedBy: row.dependencies.map((dependency) => dependency.dependsOnId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    dueDate: toLocalDay(row.dueDate),
    doneAt: row.completedAt,
    createdBy: row.createdBy,
  };
}
export function mapComment(row: ApiComment): Comment {
  return { id: row.id, taskId: row.taskId, userId: row.authorId, text: row.body, createdAt: row.createdAt };
}
export function mapMember(
  row: ApiMember,
  organizationId: string,
  favoriteProjectIds: string[],
  invited = false,
): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    initials: initialsOf(row.name || row.email),
    color: colorFor(row.id),
    title: row.title ?? "",
    roleId: toRoleId(row.role),
    orgId: organizationId,
    teamIds: row.teamIds,
    active: row.active,
    invited,
    favoriteProjectIds,
  };
}
export function mapTeam(row: ApiTeam, organizationId: string): Team {
  return {
    id: row.id,
    orgId: organizationId,
    name: row.name,
    desc: row.description ?? "",
    leadId: row.leadUserId ?? "",
    memberIds: row.memberIds,
  };
}
export function mapOrganizations(me: ApiMe): Organization[] {
  return me.memberships.map((membership) => ({
    id: membership.organizationId,
    name: membership.organizationName,
    slug: membership.organizationId,
    desc: "",
    demo: false,
  }));
}

/* ---------------------------- audit trail ---------------------------- */

const AUDIT_FIELD: Record<string, string> = {
  description: "desc",
  endDate: "targetDate",
  acceptanceCriteria: "acceptance",
  archivedAt: "archived",
  title: "title",
};
const IGNORED_FIELDS = new Set([
  "updatedAt",
  "version",
  "createdAt",
  "organizationId",
  "position",
  "taskSequence",
]);
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
/** Only the fields that changed, under the interface's names (as the demo records them). */
function changed(before: unknown, after: unknown): { before: unknown; after: unknown } {
  const b = record(before);
  const a = record(after);
  if (!b || !a) return { before: null, after: null };
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (key) => !IGNORED_FIELDS.has(key) && JSON.stringify(b[key]) !== JSON.stringify(a[key]),
  );
  const rename = (key: string) => AUDIT_FIELD[key] ?? key;
  return {
    before: Object.fromEntries(keys.map((key) => [rename(key), b[key] ?? null])),
    after: Object.fromEntries(keys.map((key) => [rename(key), a[key] ?? null])),
  };
}
const text = (value: unknown, key: string): string => {
  const field = record(value)?.[key];
  return typeof field === "string" ? field : "";
};
const statusLabel = (value: string) => STATUS_META[value as TaskStatus]?.label ?? value;

/**
 * One ms-audit event as an entry of the prototype's audit vocabulary (action, entity, summary in
 * Portuguese). Comment events are attached to their task, as in the demo history.
 */
export function mapAuditEvent(
  event: ApiAuditEvent,
  names: { user(id: string): string | undefined },
): AuditEntry {
  const before = event.data?.before ?? null;
  const after = event.data?.after ?? null;
  const subject = after ?? before;
  const ref = text(subject, "ref");
  const name = text(subject, "name") || text(subject, "title");
  let action = "update";
  let summary = "";
  let entityType = event.aggregateType;
  let entityId: string | null = event.aggregateId;
  switch (event.eventType) {
    case "project.created":
      action = "create";
      summary = `criou o projeto ${name}`;
      break;
    case "project.updated":
      summary = `atualizou o projeto ${name}`;
      break;
    case "project.archived":
      action = "archive";
      summary = `arquivou o projeto ${name}`;
      break;
    case "project.restored":
      action = "restore";
      summary = `restaurou o projeto ${name}`;
      break;
    case "epic.created":
      action = "create";
      summary = `criou o épico ${name}`;
      break;
    case "epic.deleted":
      action = "delete";
      summary = `excluiu o épico ${name}`;
      break;
    case "task.created":
      action = "create";
      summary = `criou a tarefa ${ref}`;
      break;
    case "task.status_changed":
    case "task.completed":
      action = "status";
      summary = `moveu ${ref} de ${statusLabel(text(before, "status"))} para ${statusLabel(text(after, "status"))}`;
      break;
    case "task.assigned": {
      action = "assign";
      const assignee = text(after, "assigneeId");
      summary = assignee
        ? `atribuiu ${ref} a ${names.user(assignee) ?? "?"}`
        : `removeu o responsável de ${ref}`;
      break;
    }
    case "task.deleted":
      action = "delete";
      summary = `excluiu a tarefa ${ref}`;
      break;
    case "task.updated": {
      const priorityAfter = text(after, "priority");
      if (priorityAfter && priorityAfter !== text(before, "priority")) {
        action = "priority";
        summary = `mudou a prioridade de ${ref} para ${PRIO_META[priorityAfter as Priority]?.label ?? priorityAfter}`;
      } else summary = `atualizou ${ref}`;
      break;
    }
    case "sprint.created":
      action = "create";
      summary = `criou a ${name}`;
      break;
    case "sprint.started":
      action = "sprint_start";
      summary = `iniciou a ${name}`;
      break;
    case "sprint.completed":
      action = "sprint_end";
      summary = `encerrou a ${name}`;
      break;
    case "sprint.deleted":
      action = "delete";
      summary = `excluiu a ${name}`;
      break;
    case "comment.created":
    case "comment.updated":
    case "comment.deleted": {
      action =
        event.eventType === "comment.created"
          ? "comment"
          : event.eventType === "comment.deleted"
            ? "delete"
            : "update";
      const taskId = text(subject, "taskId");
      entityType = "task";
      entityId = taskId || null;
      summary = event.eventType === "comment.created" ? "comentou na tarefa" : "alterou um comentário";
      break;
    }
    case "milestone.created":
      action = "create";
      summary = `criou o marco ${name}`;
      break;
    case "milestone.deleted":
      action = "delete";
      summary = `excluiu o marco ${name}`;
      break;
    default:
      summary = `atualizou ${entityType === "milestone" ? `o marco ${name}` : name || entityType}`;
  }
  const diff =
    action === "create" || action === "delete" ? { before: null, after: null } : changed(before, after);
  return {
    id: event.id,
    ts: event.occurredAt,
    userId: event.actorId,
    action,
    entityType,
    entityId,
    projectId: event.projectId,
    before: diff.before,
    after: diff.after,
    summary,
    source: event.actorSource,
  };
}
