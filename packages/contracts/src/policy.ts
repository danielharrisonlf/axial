import type { Role } from "./index.js";

/**
 * Pure authorization rules of ms-projects (docs/api-contracts.md). ms-projects enforces them;
 * other clients may use them only to shape UI, never as a substitute for the server check.
 * Organization scoping and reference existence are validated separately by the service.
 */
export interface PolicyActor {
  userId: string;
  role: Role;
  teamIds: readonly string[];
  projectIds: readonly string[];
  assignableUserIds: readonly string[];
  assignableTeamIds: readonly string[];
}
export interface PolicyProject {
  id: string;
  teamIds: readonly string[];
}
export interface PolicyTask {
  teamId: string | null;
  assigneeId: string | null;
}

/** Fields a CONTRIBUTOR may change on a task assigned to them (besides `version`). */
export const contributorTaskFields = ["title", "description", "status", "acceptanceCriteria"] as const;
export type ContributorTaskField = (typeof contributorTaskFields)[number];

const sharesTeam = (actor: PolicyActor, teamIds: readonly string[]) =>
  teamIds.some((id) => actor.teamIds.includes(id));
const inActorTeam = (actor: PolicyActor, teamId: string | null | undefined) =>
  !!teamId && actor.teamIds.includes(teamId);

/** ADMIN and PROJECT_MANAGER read and manage every project of their organization. */
export const isManager = (actor: Pick<PolicyActor, "role">) =>
  actor.role === "ADMIN" || actor.role === "PROJECT_MANAGER";

/** Non-managers read only explicitly allowed projects or projects of their teams. */
export const canReadProject = (actor: PolicyActor, project: PolicyProject) =>
  isManager(actor) || actor.projectIds.includes(project.id) || sharesTeam(actor, project.teamIds);

export const canCreateProject = (actor: PolicyActor) => isManager(actor);
/** Archive and restore. */
export const canArchiveProject = (actor: PolicyActor) => isManager(actor);
/** Changing `teamIds` or `leadId` of a project. */
export const canChangeProjectMembership = (actor: PolicyActor) => isManager(actor);

/** Project settings, epics, sprints and milestones; TEAM_LEAD only when the project has one of its teams. */
export const canManageProject = (actor: PolicyActor, project: PolicyProject) =>
  isManager(actor) || (actor.role === "TEAM_LEAD" && sharesTeam(actor, project.teamIds));

/** TEAM_LEAD must create tasks in one of its own teams. */
export const canCreateTask = (
  actor: PolicyActor,
  project: PolicyProject,
  teamId: string | null | undefined,
) => canManageProject(actor, project) && (actor.role !== "TEAM_LEAD" || inActorTeam(actor, teamId));

/**
 * Task fields the actor may change: "all", the contributor subset on its own assigned tasks,
 * or an empty list when the task is read only for the actor.
 */
export function editableTaskFields(
  actor: PolicyActor,
  task: PolicyTask,
): "all" | readonly ContributorTaskField[] {
  if (isManager(actor)) return "all";
  if (actor.role === "TEAM_LEAD") return inActorTeam(actor, task.teamId) ? "all" : [];
  if (actor.role === "CONTRIBUTOR" && task.assigneeId === actor.userId) return contributorTaskFields;
  return [];
}

/** True when every changed field is editable; `version` is a concurrency token, not a change. */
export function canEditTaskFields(actor: PolicyActor, task: PolicyTask, fields: readonly string[]) {
  const editable = editableTaskFields(actor, task);
  if (editable === "all") return true;
  const allowed = new Set<string>([...editable, "version"]);
  return editable.length > 0 && fields.every((field) => allowed.has(field));
}

export const canDeleteTask = (actor: PolicyActor, project: PolicyProject, task: PolicyTask) =>
  canManageProject(actor, project) && (actor.role !== "TEAM_LEAD" || inActorTeam(actor, task.teamId));

/** A user reference is valid when empty, the actor itself, or assignable per the signed token. */
export const canAssign = (actor: PolicyActor, userId: string | null | undefined) =>
  !userId || userId === actor.userId || actor.assignableUserIds.includes(userId);

export const canAssignTeams = (actor: PolicyActor, teamIds: readonly string[] | undefined) =>
  !teamIds || teamIds.every((id) => actor.assignableTeamIds.includes(id));

/** Every role except VIEWER may comment. */
export const canComment = (actor: Pick<PolicyActor, "role">) => actor.role !== "VIEWER";

/** Edit or delete a comment: its author or a manager. */
export const canModifyComment = (actor: PolicyActor, comment: { authorId: string }) =>
  canComment(actor) && (comment.authorId === actor.userId || isManager(actor));
