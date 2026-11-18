import type {
  AcceptanceCriterion,
  DomainEventEnvelope,
  DomainEventType,
  EventSource,
  Priority,
  Role,
  TaskStatus,
} from "@axial/contracts";
import { sourceSchema } from "@axial/contracts";
import { DEMO_TIME_ZONE, localDay, shift } from "./dates.js";
import { demoId } from "./ids.js";
import { type LegacyRoleId, type LegacySeed, legacySeed } from "./source.js";

/** Prototype role id → backend role. */
export const ROLE_MAP: Readonly<Record<LegacyRoleId, Role>> = {
  admin: "ADMIN",
  pm: "PROJECT_MANAGER",
  lead: "TEAM_LEAD",
  dev: "CONTRIBUTOR",
  viewer: "VIEWER",
};

export interface DemoOrganization {
  id: string;
  legacyId: string;
  name: string;
  slug: string;
  description: string;
}
export interface DemoRole {
  role: Role;
  legacyId: LegacyRoleId;
  name: string;
}
export interface DemoUser {
  id: string;
  legacyId: string;
  organizationId: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  title: string;
  role: Role;
  teamIds: string[];
  active: boolean;
}
export interface DemoTeam {
  id: string;
  legacyId: string;
  organizationId: string;
  name: string;
  description: string;
  leadId: string;
  memberIds: string[];
}
/** One organization membership per user (identity.members). */
export interface DemoMembership {
  organizationId: string;
  userId: string;
  role: Role;
}
/** identity.team_members. */
export interface DemoTeamMembership {
  organizationId: string;
  teamId: string;
  userId: string;
}
/**
 * identity.project_assignments: explicit project access besides team membership. `lead` is the
 * project lead, `team` a PM or team lead of one of the project's teams, `viewer` an organization
 * VIEWER (read access to every project of the organization).
 */
export interface DemoProjectAssignment {
  organizationId: string;
  projectId: string;
  userId: string;
  reasons: ("lead" | "team" | "viewer")[];
}
/** Claims identity issues for a seeded user (same rules as ms-identity `claims`). */
export interface DemoClaims {
  userId: string;
  organizationId: string;
  role: Role;
  teamIds: string[];
  projectIds: string[];
  assignableUserIds: string[];
  assignableTeamIds: string[];
}

export interface DemoProject {
  id: string;
  legacyId: string;
  organizationId: string;
  key: string;
  name: string;
  description: string;
  color: string;
  status: "active" | "paused" | "done";
  priority: Priority;
  leadId: string;
  teamIds: string[];
  startDate: string | null;
  endDate: string | null;
  archivedAt: string | null;
  /** Highest task number, so the next task created through the API continues the sequence. */
  taskSequence: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface DemoEpic {
  id: string;
  legacyId: string;
  organizationId: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}
export interface DemoSprint {
  id: string;
  legacyId: string;
  organizationId: string;
  projectId: string;
  name: string;
  goal: string;
  status: "planned" | "active" | "done";
  startDate: string;
  endDate: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DemoMilestone {
  id: string;
  legacyId: string;
  organizationId: string;
  projectId: string;
  name: string;
  date: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DemoTask {
  id: string;
  legacyId: string;
  organizationId: string;
  projectId: string;
  number: number;
  ref: string;
  title: string;
  description: string;
  type: "task" | "bug" | "subtask";
  status: TaskStatus;
  priority: Priority;
  assigneeId: string | null;
  teamId: string | null;
  epicId: string | null;
  sprintId: string | null;
  parentId: string | null;
  labels: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  position: number;
  dueDate: string | null;
  completedAt: string | null;
  blockedByIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface DemoComment {
  id: string;
  legacyId: string;
  organizationId: string;
  projectId: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}
export interface DemoAuditEvent extends DomainEventEnvelope {
  legacyId: string;
}

export interface DemoFixtures {
  generatedAt: string;
  timeZone: string;
  organizations: DemoOrganization[];
  roles: DemoRole[];
  users: DemoUser[];
  teams: DemoTeam[];
  memberships: DemoMembership[];
  teamMemberships: DemoTeamMembership[];
  projectAssignments: DemoProjectAssignment[];
  projects: DemoProject[];
  epics: DemoEpic[];
  sprints: DemoSprint[];
  milestones: DemoMilestone[];
  tasks: DemoTask[];
  comments: DemoComment[];
  auditEvents: DemoAuditEvent[];
  /**
   * Legacy records deliberately left out, with the reason: audit entries the backend never
   * records (denied attempts, notification and user administration) and records of the
   * prototype that cross organizations (an author or actor of another tenant), which ms-projects
   * and ms-audit would never accept.
   */
  excluded: DemoExclusion[];
}
export interface DemoExclusion {
  kind: "comment" | "audit";
  legacyId: string;
  reason: string;
}

function find<T extends { id: string }>(items: readonly T[], id: string, kind: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Demo seed references unknown ${kind} ${id}`);
  return item;
}

// ------------------------------------------------------------------ date independent records

function buildDirectory(seed: LegacySeed) {
  const organizations: DemoOrganization[] = seed.orgs.map((org) => ({
    id: demoId(org.id),
    legacyId: org.id,
    name: org.name,
    slug: org.slug,
    description: org.desc,
  }));
  const roles: DemoRole[] = seed.roles.map((role) => ({
    role: ROLE_MAP[role.id],
    legacyId: role.id,
    name: role.name,
  }));
  const users: DemoUser[] = seed.users.map((user) => ({
    id: demoId(user.id),
    legacyId: user.id,
    organizationId: demoId(user.orgId),
    name: user.name,
    email: user.email,
    initials: user.initials,
    color: user.color,
    title: user.title,
    role: ROLE_MAP[user.roleId],
    teamIds: user.teamIds.map(demoId),
    active: user.active,
  }));
  const teams: DemoTeam[] = seed.teams.map((team) => ({
    id: demoId(team.id),
    legacyId: team.id,
    organizationId: demoId(team.orgId),
    name: team.name,
    description: team.desc,
    leadId: demoId(team.leadId),
    memberIds: team.memberIds.map(demoId),
  }));
  const memberships: DemoMembership[] = users.map((user) => ({
    organizationId: user.organizationId,
    userId: user.id,
    role: user.role,
  }));
  const teamMemberships: DemoTeamMembership[] = teams.flatMap((team) =>
    team.memberIds.map((userId) => ({ organizationId: team.organizationId, teamId: team.id, userId })),
  );
  const assignments = new Map<string, DemoProjectAssignment>();
  const assign = (
    organizationId: string,
    projectId: string,
    userId: string,
    reason: DemoProjectAssignment["reasons"][number],
  ) => {
    const key = `${projectId}:${userId}`;
    const current = assignments.get(key) ?? { organizationId, projectId, userId, reasons: [] };
    if (!current.reasons.includes(reason)) current.reasons.push(reason);
    assignments.set(key, current);
  };
  for (const project of seed.projects) {
    const organizationId = demoId(project.orgId);
    const projectId = demoId(project.id);
    assign(organizationId, projectId, demoId(project.leadId), "lead");
    for (const legacyTeamId of project.teamIds) {
      const team = find(seed.teams, legacyTeamId, "team");
      const managers = team.memberIds.filter((userId) => {
        const role = find(seed.users, userId, "user").roleId;
        return role === "pm" || role === "lead";
      });
      for (const userId of new Set([team.leadId, ...managers]))
        assign(organizationId, projectId, demoId(userId), "team");
    }
    for (const viewer of seed.users.filter(
      (user) => user.orgId === project.orgId && user.roleId === "viewer",
    ))
      assign(organizationId, projectId, demoId(viewer.id), "viewer");
  }
  const projectAssignments = [...assignments.values()];
  return { organizations, roles, users, teams, memberships, teamMemberships, projectAssignments };
}

const directory = buildDirectory(legacySeed);
/** Fictional organizations: Vetor Labs (main scenario) and Atlas (second tenant). */
export const organizations: readonly DemoOrganization[] = directory.organizations;
export const roles: readonly DemoRole[] = directory.roles;
export const users: readonly DemoUser[] = directory.users;
export const teams: readonly DemoTeam[] = directory.teams;
export const memberships: readonly DemoMembership[] = directory.memberships;
export const teamMemberships: readonly DemoTeamMembership[] = directory.teamMemberships;
export const projectAssignments: readonly DemoProjectAssignment[] = directory.projectAssignments;
/** Deterministic id of the Vetor Labs organization, the scenario the dev tokens open. */
export const VETOR_ORGANIZATION_ID = demoId("org-vetor");
export const ATLAS_ORGANIZATION_ID = demoId("org-atlas");

/** User by e-mail; throws for an unknown address. */
export function demoUser(email: string): DemoUser {
  const user = users.find((candidate) => candidate.email === email);
  if (!user) throw new Error(`Unknown demo user ${email}`);
  return user;
}

/** Claims ms-identity issues to a seeded user: teams, explicit projects and the organization roster. */
export function claimsFor(userId: string): DemoClaims {
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) throw new Error(`Unknown demo user ${userId}`);
  const sorted = (ids: string[]) => [...new Set(ids)].sort();
  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    teamIds: sorted(
      teamMemberships.filter((member) => member.userId === user.id).map((member) => member.teamId),
    ),
    projectIds: sorted(
      projectAssignments.filter((entry) => entry.userId === user.id).map((entry) => entry.projectId),
    ),
    assignableUserIds: sorted(
      memberships.filter((member) => member.organizationId === user.organizationId).map((m) => m.userId),
    ),
    assignableTeamIds: sorted(
      teams.filter((team) => team.organizationId === user.organizationId).map((team) => team.id),
    ),
  };
}

// ------------------------------------------------------------------ dated records

const epicStatus: Record<"active" | "done", TaskStatus> = { active: "in_progress", done: "done" };

/** Legacy audit action → backend event type; `null` marks entries the backend never records. */
function auditEventType(
  entry: LegacySeed["audit"][number],
): { type: DomainEventType; aggregate: string } | null {
  if (entry.action.includes("denied") || entry.entityType === "notification" || entry.entityType === "user")
    return null;
  const after = entry.after as { status?: unknown } | null;
  const key = `${entry.entityType}.${entry.action}`;
  const map: Record<string, DomainEventType> = {
    "project.create": "project.created",
    "project.update": "project.updated",
    "project.archive": "project.archived",
    "project.restore": "project.restored",
    "epic.create": "epic.created",
    "epic.update": "epic.updated",
    "task.create": "task.created",
    "task.update": "task.updated",
    "task.status": after?.status === "done" ? "task.completed" : "task.status_changed",
    "task.assign": "task.assigned",
    "task.delete": "task.deleted",
    "sprint.create": "sprint.created",
    "sprint.sprint_start": "sprint.started",
    "sprint.sprint_complete": "sprint.completed",
    "comment.create": "comment.created",
    "milestone.create": "milestone.created",
  };
  const type = map[key];
  if (!type) throw new Error(`Demo audit entry ${entry.id} has no backend event for ${key}`);
  return { type, aggregate: entry.entityType };
}

/** Legacy ids inside `*Id`/`*Ids` fields of audit payloads become the seeded ids. */
function remapIds(value: unknown, known: ReadonlySet<string>, key = ""): unknown {
  const isIdKey = /Ids?$/.test(key);
  if (typeof value === "string") return isIdKey && known.has(value) ? demoId(value) : value;
  if (Array.isArray(value)) return value.map((item) => remapIds(item, known, key));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, remapIds(item, known, name)]),
    );
  return value;
}

const iso = (at: number) => new Date(at).toISOString();

/**
 * The whole scenario with dates relative to `now` (same shift as the web demo) in backend shape.
 * Deterministic for a given `now`: ids never depend on it.
 */
export function buildDemoFixtures(options: { now?: Date; timeZone?: string } = {}): DemoFixtures {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? DEMO_TIME_ZONE;
  const nowMs = now.getTime();
  const seed = shift(now, timeZone);
  const day = (ymd: string, edge: "start" | "end") => new Date(localDay(ymd, timeZone, edge)).getTime();
  const notAfterNow = (at: number) => Math.min(at, nowMs);

  const projectOrg = (legacyProjectId: string) =>
    demoId(find(seed.projects, legacyProjectId, "project").orgId);
  const tasksOf = (legacyProjectId: string) =>
    seed.tasks.filter((task) => task.projectId === legacyProjectId);

  const projects: DemoProject[] = seed.projects.map((project) => {
    const numbers = tasksOf(project.id).map((task) => {
      const [prefix, suffix] = task.ref.split("-");
      if (prefix !== project.key || !suffix || !/^\d+$/.test(suffix))
        throw new Error(`Task ${task.id} ref ${task.ref} does not belong to ${project.key}`);
      return Number(suffix);
    });
    const creation = seed.audit.find(
      (entry) => entry.entityType === "project" && entry.action === "create" && entry.entityId === project.id,
    );
    return {
      id: demoId(project.id),
      legacyId: project.id,
      organizationId: demoId(project.orgId),
      key: project.key,
      name: project.name,
      description: project.desc,
      color: project.color,
      status: project.status,
      priority: project.priority,
      leadId: demoId(project.leadId),
      teamIds: project.teamIds.map(demoId),
      startDate: localDay(project.startDate, timeZone, "start"),
      endDate: project.targetDate ? localDay(project.targetDate, timeZone, "end") : null,
      archivedAt: project.archived ? project.createdAt : null,
      taskSequence: Math.max(0, ...numbers),
      createdBy: demoId(creation?.userId ?? project.leadId),
      createdAt: project.createdAt,
      updatedAt: project.createdAt,
    };
  });
  const projectCreated = (legacyProjectId: string) =>
    Date.parse(find(seed.projects, legacyProjectId, "project").createdAt);

  const epics: DemoEpic[] = seed.epics.map((epic) => {
    const projectStart = projectCreated(epic.projectId);
    const firstTask = Math.min(
      ...seed.tasks.filter((task) => task.epicId === epic.id).map((task) => Date.parse(task.createdAt)),
    );
    const createdAt = iso(Number.isFinite(firstTask) ? Math.max(projectStart, firstTask) : projectStart);
    return {
      id: demoId(epic.id),
      legacyId: epic.id,
      organizationId: projectOrg(epic.projectId),
      projectId: demoId(epic.projectId),
      title: epic.name,
      description: epic.desc,
      status: epicStatus[epic.status],
      ownerId: demoId(epic.ownerId),
      createdAt,
      updatedAt: createdAt,
    };
  });

  const sprints: DemoSprint[] = seed.sprints.map((sprint) => {
    const start = day(sprint.startDate, "start");
    const startEvent = seed.audit.find(
      (entry) =>
        entry.entityType === "sprint" && entry.action === "sprint_start" && entry.entityId === sprint.id,
    );
    const startedAt =
      sprint.status === "planned" ? null : notAfterNow(startEvent ? Date.parse(startEvent.ts) : start);
    const completedAt = sprint.status === "done" ? notAfterNow(day(sprint.endDate, "end")) : null;
    const createdAt = notAfterNow(
      Math.min(Math.max(projectCreated(sprint.projectId), start - 7 * 86_400_000), startedAt ?? start),
    );
    return {
      id: demoId(sprint.id),
      legacyId: sprint.id,
      organizationId: projectOrg(sprint.projectId),
      projectId: demoId(sprint.projectId),
      name: sprint.name,
      goal: sprint.goal,
      status: sprint.status,
      startDate: localDay(sprint.startDate, timeZone, "start"),
      endDate: localDay(sprint.endDate, timeZone, "end"),
      startedAt: startedAt === null ? null : iso(startedAt),
      completedAt: completedAt === null ? null : iso(completedAt),
      createdAt: iso(createdAt),
      updatedAt: iso(Math.max(createdAt, completedAt ?? startedAt ?? createdAt)),
    };
  });

  const milestones: DemoMilestone[] = seed.milestones.map((milestone) => {
    const createdAt = projectCreated(milestone.projectId);
    const completedAt = milestone.status === "done" ? notAfterNow(day(milestone.date, "end")) : null;
    return {
      id: demoId(milestone.id),
      legacyId: milestone.id,
      organizationId: projectOrg(milestone.projectId),
      projectId: demoId(milestone.projectId),
      name: milestone.name,
      date: localDay(milestone.date, timeZone, "end"),
      completedAt: completedAt === null ? null : iso(completedAt),
      createdAt: iso(createdAt),
      updatedAt: iso(Math.max(createdAt, completedAt ?? createdAt)),
    };
  });

  const positions = new Map<string, number>();
  const tasks: DemoTask[] = seed.tasks.map((task) => {
    const column = `${task.projectId}:${task.status}`;
    const position = (positions.get(column) ?? 0) + 1000;
    positions.set(column, position);
    return {
      id: demoId(task.id),
      legacyId: task.id,
      organizationId: projectOrg(task.projectId),
      projectId: demoId(task.projectId),
      number: Number(task.ref.split("-")[1]),
      ref: task.ref,
      title: task.title,
      description: task.desc,
      type: task.type,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId ? demoId(task.assigneeId) : null,
      teamId: task.teamId ? demoId(task.teamId) : null,
      epicId: task.epicId ? demoId(task.epicId) : null,
      sprintId: task.sprintId ? demoId(task.sprintId) : null,
      parentId: task.parentId ? demoId(task.parentId) : null,
      labels: [...task.labels],
      acceptanceCriteria: task.acceptance.map((criterion) => ({
        text: criterion.text,
        done: criterion.done,
      })),
      position,
      dueDate: task.dueDate ? localDay(task.dueDate, timeZone, "end") : null,
      // same rule as the web migration 8 → 9: the last update of a done task is its completion
      completedAt: task.status === "done" ? task.updatedAt : null,
      blockedByIds: task.blockedBy.map(demoId),
      createdBy: demoId(task.createdBy),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  });

  const excluded: DemoExclusion[] = [];
  const userOrg = (legacyUserId: string) => demoId(find(seed.users, legacyUserId, "user").orgId);
  const comments: DemoComment[] = seed.comments.flatMap((comment): DemoComment[] => {
    const task = find(seed.tasks, comment.taskId, "task");
    if (userOrg(comment.userId) !== projectOrg(task.projectId)) {
      excluded.push({
        kind: "comment",
        legacyId: comment.id,
        reason: "author belongs to another organization",
      });
      return [];
    }
    return [
      {
        id: demoId(comment.id),
        legacyId: comment.id,
        organizationId: projectOrg(task.projectId),
        projectId: demoId(task.projectId),
        taskId: demoId(task.id),
        authorId: demoId(comment.userId),
        body: comment.text,
        createdAt: comment.createdAt,
        updatedAt: comment.createdAt,
      },
    ];
  });

  const known = new Set<string>(
    [seed.orgs, seed.users, seed.teams, seed.projects, seed.epics, seed.sprints, seed.tasks].flatMap(
      (items) => items.map((item) => item.id),
    ),
  );
  const versions = new Map<string, number>();
  const auditEvents: DemoAuditEvent[] = [...seed.audit]
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id))
    .flatMap((entry): DemoAuditEvent[] => {
      const mapped = auditEventType(entry);
      if (!mapped) {
        excluded.push({ kind: "audit", legacyId: entry.id, reason: "not a domain event of the backend" });
        return [];
      }
      const legacyProjectId = entry.projectId ?? (entry.entityType === "project" ? entry.entityId : null);
      if (!legacyProjectId || !entry.entityId)
        throw new Error(`Demo audit entry ${entry.id} has no project or aggregate`);
      if (userOrg(entry.userId) !== projectOrg(legacyProjectId)) {
        excluded.push({ kind: "audit", legacyId: entry.id, reason: "actor belongs to another organization" });
        return [];
      }
      const source: EventSource = sourceSchema.parse(entry.source);
      const aggregateId = demoId(entry.entityId);
      const previous = versions.get(aggregateId);
      const version = mapped.type.endsWith(".created") ? 1 : (previous ?? 1) + 1;
      versions.set(aggregateId, version);
      return [
        {
          legacyId: entry.id,
          id: demoId(entry.id),
          type: mapped.type,
          version: 1,
          occurredAt: entry.ts,
          organizationId: projectOrg(legacyProjectId),
          projectId: demoId(legacyProjectId),
          aggregate: { type: mapped.aggregate, id: aggregateId, version },
          actor: { id: demoId(entry.userId), source },
          correlationId: `demo-seed-${entry.id}`,
          data: { before: remapIds(entry.before, known), after: remapIds(entry.after, known) },
        },
      ];
    });

  return {
    generatedAt: now.toISOString(),
    timeZone,
    organizations: [...organizations],
    roles: [...roles],
    users: [...users],
    teams: [...teams],
    memberships: [...memberships],
    teamMemberships: [...teamMemberships],
    projectAssignments: [...projectAssignments],
    projects,
    epics,
    sprints,
    milestones,
    tasks,
    comments,
    auditEvents,
    excluded,
  };
}
