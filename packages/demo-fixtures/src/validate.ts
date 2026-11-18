import {
  createCommentSchema,
  createEpicSchema,
  createMilestoneSchema,
  createProjectSchema,
  createSprintSchema,
  createTaskSchema,
  domainEventEnvelopeSchema,
  idSchema,
  roleSchema,
  taskStatusSchema,
} from "@axial/contracts";
import type { z } from "zod";
import type { DemoFixtures } from "./fixtures.js";

/**
 * Checks the scenario against the public contracts and the ms-projects invariants the seed
 * bypasses by writing rows directly: references inside organization and project, one active
 * sprint per project, one subtask level, acyclic dependencies and unique refs. Returns every
 * problem found; an empty list means the fixtures are consistent.
 */
export function validateFixtures(fixtures: DemoFixtures): string[] {
  const problems: string[] = [];
  const check = (condition: boolean, message: string) => {
    if (!condition) problems.push(message);
  };
  const parse = (schema: z.ZodType, value: unknown, label: string) => {
    const result = schema.safeParse(value);
    if (!result.success)
      problems.push(
        `${label}: ${result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
      );
  };

  const allIds = [
    ...fixtures.organizations,
    ...fixtures.users,
    ...fixtures.teams,
    ...fixtures.projects,
    ...fixtures.epics,
    ...fixtures.sprints,
    ...fixtures.milestones,
    ...fixtures.tasks,
    ...fixtures.comments,
    ...fixtures.auditEvents,
  ].map((item) => item.id);
  check(new Set(allIds).size === allIds.length, "ids must be unique across the scenario");
  for (const id of allIds) check(idSchema.safeParse(id).success, `${id} is not a UUID`);

  const org = new Map(fixtures.organizations.map((item) => [item.id, item]));
  const user = new Map(fixtures.users.map((item) => [item.id, item]));
  const team = new Map(fixtures.teams.map((item) => [item.id, item]));
  const project = new Map(fixtures.projects.map((item) => [item.id, item]));
  const epic = new Map(fixtures.epics.map((item) => [item.id, item]));
  const sprint = new Map(fixtures.sprints.map((item) => [item.id, item]));
  const task = new Map(fixtures.tasks.map((item) => [item.id, item]));
  const userIn = (id: string | null, organizationId: string) =>
    !id || user.get(id)?.organizationId === organizationId;
  const inProject = <T extends { projectId: string }>(
    map: Map<string, T>,
    id: string | null,
    projectId: string,
  ) => !id || map.get(id)?.projectId === projectId;

  const emails = fixtures.users.map((item) => item.email.toLowerCase());
  check(new Set(emails).size === emails.length, "user e-mails must be unique");
  for (const item of fixtures.users) {
    check(org.has(item.organizationId), `user ${item.email} has an unknown organization`);
    check(roleSchema.safeParse(item.role).success, `user ${item.email} has an unknown role`);
    for (const teamId of item.teamIds)
      check(
        team.get(teamId)?.memberIds.includes(item.id) === true,
        `user ${item.email} lists team ${teamId} that does not list the user`,
      );
  }
  for (const item of fixtures.teams) {
    check(org.has(item.organizationId), `team ${item.name} has an unknown organization`);
    check(userIn(item.leadId, item.organizationId), `team ${item.name} lead is outside the organization`);
    for (const memberId of item.memberIds) {
      check(userIn(memberId, item.organizationId), `team ${item.name} member is outside the organization`);
      check(
        user.get(memberId)?.teamIds.includes(item.id) === true,
        `team ${item.name} member does not list the team`,
      );
    }
  }
  for (const item of fixtures.projectAssignments) {
    check(project.get(item.projectId)?.organizationId === item.organizationId, "assignment project mismatch");
    check(userIn(item.userId, item.organizationId), "assignment user is outside the organization");
  }

  const keys = fixtures.projects.map((item) => `${item.organizationId}:${item.key}`);
  check(new Set(keys).size === keys.length, "project keys must be unique per organization");
  for (const item of fixtures.projects) {
    parse(
      createProjectSchema,
      {
        key: item.key,
        name: item.name,
        description: item.description,
        color: item.color,
        priority: item.priority,
        leadId: item.leadId,
        teamIds: item.teamIds,
        startDate: item.startDate,
        endDate: item.endDate,
      },
      `project ${item.key}`,
    );
    check(org.has(item.organizationId), `project ${item.key} has an unknown organization`);
    check(userIn(item.leadId, item.organizationId), `project ${item.key} lead is outside the organization`);
    check(
      userIn(item.createdBy, item.organizationId),
      `project ${item.key} creator is outside the organization`,
    );
    for (const teamId of item.teamIds)
      check(
        team.get(teamId)?.organizationId === item.organizationId,
        `project ${item.key} team is outside the organization`,
      );
    const numbers = fixtures.tasks.filter((t) => t.projectId === item.id).map((t) => t.number);
    check(
      item.taskSequence === Math.max(0, ...numbers),
      `project ${item.key} task sequence must match its last task`,
    );
    const active = fixtures.sprints.filter((s) => s.projectId === item.id && s.status === "active");
    check(active.length <= 1, `project ${item.key} has more than one active sprint`);
  }

  for (const item of fixtures.epics) {
    parse(
      createEpicSchema,
      { title: item.title, description: item.description, ownerId: item.ownerId },
      `epic ${item.title}`,
    );
    check(taskStatusSchema.safeParse(item.status).success, `epic ${item.title} has an unknown status`);
    check(
      project.get(item.projectId)?.organizationId === item.organizationId,
      `epic ${item.title} project mismatch`,
    );
    check(userIn(item.ownerId, item.organizationId), `epic ${item.title} owner is outside the organization`);
  }
  for (const item of fixtures.sprints) {
    parse(
      createSprintSchema,
      { name: item.name, goal: item.goal, startDate: item.startDate, endDate: item.endDate },
      `sprint ${item.name}`,
    );
    check(
      project.get(item.projectId)?.organizationId === item.organizationId,
      `sprint ${item.name} project mismatch`,
    );
    check(Date.parse(item.startDate) < Date.parse(item.endDate), `sprint ${item.name} ends before it starts`);
    check(
      (item.status === "planned") === (item.startedAt === null),
      `sprint ${item.name} startedAt mismatch`,
    );
    check(
      (item.status === "done") === (item.completedAt !== null),
      `sprint ${item.name} completedAt mismatch`,
    );
  }
  for (const item of fixtures.milestones) {
    parse(createMilestoneSchema, { name: item.name, date: item.date }, `milestone ${item.name}`);
    check(
      project.get(item.projectId)?.organizationId === item.organizationId,
      `milestone ${item.name} project mismatch`,
    );
  }

  const refs = fixtures.tasks.map((item) => `${item.organizationId}:${item.ref}`);
  check(new Set(refs).size === refs.length, "task refs must be unique per organization");
  for (const item of fixtures.tasks) {
    const label = `task ${item.ref}`;
    const owner = project.get(item.projectId);
    parse(
      createTaskSchema,
      {
        title: item.title,
        description: item.description,
        type: item.type,
        status: item.status,
        priority: item.priority,
        assigneeId: item.assigneeId,
        teamId: item.teamId,
        epicId: item.epicId,
        sprintId: item.sprintId,
        parentId: item.parentId,
        labels: item.labels,
        acceptanceCriteria: item.acceptanceCriteria,
        position: item.position,
        dueDate: item.dueDate,
        blockedByIds: item.blockedByIds,
      },
      label,
    );
    check(owner?.organizationId === item.organizationId, `${label} project mismatch`);
    check(item.ref === `${owner?.key}-${item.number}`, `${label} ref must be <project key>-<number>`);
    check(userIn(item.assigneeId, item.organizationId), `${label} assignee is outside the organization`);
    check(userIn(item.createdBy, item.organizationId), `${label} creator is outside the organization`);
    check(
      !item.teamId || owner?.teamIds.includes(item.teamId) === true,
      `${label} team must belong to the project`,
    );
    check(inProject(epic, item.epicId, item.projectId), `${label} epic is outside the project`);
    check(inProject(sprint, item.sprintId, item.projectId), `${label} sprint is outside the project`);
    check((item.status === "done") === (item.completedAt !== null), `${label} completedAt mismatch`);
    if (item.parentId) {
      const parent = task.get(item.parentId);
      check(parent?.projectId === item.projectId, `${label} parent is outside the project`);
      check(item.type === "subtask", `${label} has a parent but is not a subtask`);
      check(!!parent && !parent.parentId && parent.type !== "subtask", `${label} nests below a subtask`);
      check(parent?.status !== "done" || item.status === "done", `${label} is open under a completed parent`);
    } else check(item.type !== "subtask", `${label} is a subtask without parent`);
    check(new Set(item.blockedByIds).size === item.blockedByIds.length, `${label} repeats a dependency`);
    for (const dependency of item.blockedByIds) {
      check(dependency !== item.id, `${label} depends on itself`);
      check(task.get(dependency)?.projectId === item.projectId, `${label} dependency is outside the project`);
    }
  }
  // dependency graph must be acyclic (depth-first search with colors)
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      problems.push(
        `dependency cycle: ${[...path, id].map((step) => task.get(step)?.ref ?? step).join(" -> ")}`,
      );
      return;
    }
    state.set(id, "visiting");
    for (const next of task.get(id)?.blockedByIds ?? []) visit(next, [...path, id]);
    state.set(id, "done");
  };
  for (const item of fixtures.tasks) visit(item.id, []);

  for (const item of fixtures.comments) {
    parse(createCommentSchema, { body: item.body }, `comment ${item.legacyId}`);
    check(task.get(item.taskId)?.projectId === item.projectId, `comment ${item.legacyId} task mismatch`);
    check(
      userIn(item.authorId, item.organizationId),
      `comment ${item.legacyId} author is outside the organization`,
    );
  }
  for (const item of fixtures.auditEvents) {
    const { legacyId, ...envelope } = item;
    parse(domainEventEnvelopeSchema, envelope, `audit ${legacyId}`);
    check(
      !!item.projectId && project.get(item.projectId)?.organizationId === item.organizationId,
      `audit ${legacyId} project mismatch`,
    );
    check(userIn(item.actor.id, item.organizationId), `audit ${legacyId} actor is outside the organization`);
  }
  return problems;
}

/** Throws with every problem when the fixtures are inconsistent. */
export function assertValidFixtures(fixtures: DemoFixtures): void {
  const problems = validateFixtures(fixtures);
  if (problems.length) throw new Error(`Invalid demo fixtures:\n- ${problems.join("\n- ")}`);
}
