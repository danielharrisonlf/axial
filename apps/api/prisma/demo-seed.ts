import type { DemoFixtures, DemoProject } from "@axial/demo-fixtures";
import type { PrismaClient } from "../src/generated/prisma/client.js";

type Transaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export interface ProjectSeedCounts {
  projects: number;
  epics: number;
  sprints: number;
  milestones: number;
  tasks: number;
  dependencies: number;
  comments: number;
}
export interface ProjectSeedReport {
  /** Rows written by this run; zero everywhere on a repeated run. */
  inserted: ProjectSeedCounts;
  /** Rows of the scenario present after the run. */
  present: ProjectSeedCounts;
}

const empty = (): ProjectSeedCounts => ({
  projects: 0,
  epics: 0,
  sprints: 0,
  milestones: 0,
  tasks: 0,
  dependencies: 0,
  comments: 0,
});
const date = (value: string | null) => (value === null ? null : new Date(value));

/**
 * Writes the demonstration scenario of ms-projects: insert only, idempotent by deterministic id,
 * one transaction per project. Rows keep their historical timestamps and refs; the project task
 * sequence continues after the last seeded number. No outbox rows are written: the history of
 * the scenario is seeded into ms-audit directly, and publishing it again would duplicate audit
 * events and fire realtime updates and notifications for things that never happened.
 * Existing rows are never updated or deleted (including the older AXL demonstration project).
 */
export async function seedProjects(db: PrismaClient, fixtures: DemoFixtures): Promise<ProjectSeedReport> {
  const inserted = empty();
  const present = empty();
  for (const project of fixtures.projects) {
    await db.$transaction(
      async (tx) => {
        const counts = await seedProject(tx, fixtures, project);
        for (const key of Object.keys(inserted) as (keyof ProjectSeedCounts)[]) inserted[key] += counts[key];
        const totals = await verifyProject(tx, fixtures, project);
        for (const key of Object.keys(present) as (keyof ProjectSeedCounts)[]) present[key] += totals[key];
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }
  return { inserted, present };
}

async function seedProject(
  tx: Transaction,
  fixtures: DemoFixtures,
  project: DemoProject,
): Promise<ProjectSeedCounts> {
  const owned = <T extends { projectId: string }>(items: T[]) =>
    items.filter((item) => item.projectId === project.id);
  const clash = await tx.project.findUnique({
    where: { organizationId_key: { organizationId: project.organizationId, key: project.key } },
    select: { id: true },
  });
  if (clash && clash.id !== project.id)
    throw new Error(
      `Project key ${project.key} already belongs to another project (${clash.id}); the demo seed never overwrites it`,
    );
  // serializes with concurrent writers of the same project, like the service does
  if (clash)
    await tx.$queryRaw`SELECT "id" FROM "projects"."Project" WHERE "id" = ${project.id}::uuid FOR UPDATE`;
  const counts = empty();
  counts.projects = (
    await tx.project.createMany({
      skipDuplicates: true,
      data: [
        {
          id: project.id,
          organizationId: project.organizationId,
          key: project.key,
          name: project.name,
          description: project.description,
          color: project.color,
          status: project.status,
          priority: project.priority,
          leadId: project.leadId,
          teamIds: project.teamIds,
          startDate: date(project.startDate),
          endDate: date(project.endDate),
          archivedAt: date(project.archivedAt),
          taskSequence: project.taskSequence,
          createdBy: project.createdBy,
          createdAt: new Date(project.createdAt),
          updatedAt: new Date(project.updatedAt),
        },
      ],
    })
  ).count;
  counts.epics = (
    await tx.epic.createMany({
      skipDuplicates: true,
      data: owned(fixtures.epics).map((epic) => ({
        id: epic.id,
        organizationId: epic.organizationId,
        projectId: epic.projectId,
        title: epic.title,
        description: epic.description,
        status: epic.status,
        ownerId: epic.ownerId,
        createdAt: new Date(epic.createdAt),
        updatedAt: new Date(epic.updatedAt),
      })),
    })
  ).count;
  counts.sprints = (
    await tx.sprint.createMany({
      skipDuplicates: true,
      data: owned(fixtures.sprints).map((sprint) => ({
        id: sprint.id,
        organizationId: sprint.organizationId,
        projectId: sprint.projectId,
        name: sprint.name,
        goal: sprint.goal,
        status: sprint.status,
        startDate: new Date(sprint.startDate),
        endDate: new Date(sprint.endDate),
        startedAt: date(sprint.startedAt),
        completedAt: date(sprint.completedAt),
        createdAt: new Date(sprint.createdAt),
        updatedAt: new Date(sprint.updatedAt),
      })),
    })
  ).count;
  counts.milestones = (
    await tx.milestone.createMany({
      skipDuplicates: true,
      data: owned(fixtures.milestones).map((milestone) => ({
        id: milestone.id,
        organizationId: milestone.organizationId,
        projectId: milestone.projectId,
        name: milestone.name,
        date: new Date(milestone.date),
        completedAt: date(milestone.completedAt),
        createdAt: new Date(milestone.createdAt),
        updatedAt: new Date(milestone.updatedAt),
      })),
    })
  ).count;
  const tasks = owned(fixtures.tasks);
  // parents first: subtasks reference them
  for (const level of [tasks.filter((task) => !task.parentId), tasks.filter((task) => task.parentId)]) {
    if (!level.length) continue;
    counts.tasks += (
      await tx.task.createMany({
        skipDuplicates: true,
        data: level.map((task) => ({
          id: task.id,
          organizationId: task.organizationId,
          projectId: task.projectId,
          number: task.number,
          ref: task.ref,
          title: task.title,
          description: task.description,
          type: task.type,
          status: task.status,
          priority: task.priority,
          assigneeId: task.assigneeId,
          teamId: task.teamId,
          epicId: task.epicId,
          sprintId: task.sprintId,
          parentId: task.parentId,
          labels: task.labels,
          acceptanceCriteria: task.acceptanceCriteria,
          position: task.position,
          dueDate: date(task.dueDate),
          completedAt: date(task.completedAt),
          createdBy: task.createdBy,
          createdAt: new Date(task.createdAt),
          updatedAt: new Date(task.updatedAt),
        })),
      })
    ).count;
  }
  const dependencies = tasks.flatMap((task) =>
    task.blockedByIds.map((dependsOnId) => ({
      organizationId: task.organizationId,
      projectId: task.projectId,
      taskId: task.id,
      dependsOnId,
    })),
  );
  if (dependencies.length)
    counts.dependencies = (
      await tx.taskDependency.createMany({ skipDuplicates: true, data: dependencies })
    ).count;
  const comments = owned(fixtures.comments);
  if (comments.length)
    counts.comments = (
      await tx.comment.createMany({
        skipDuplicates: true,
        data: comments.map((comment) => ({
          id: comment.id,
          organizationId: comment.organizationId,
          projectId: comment.projectId,
          taskId: comment.taskId,
          authorId: comment.authorId,
          body: comment.body,
          createdAt: new Date(comment.createdAt),
          updatedAt: new Date(comment.updatedAt),
        })),
      })
    ).count;
  return counts;
}

/**
 * `skipDuplicates` also skips rows that collide on another unique key (a ref taken by a task
 * of another id, for example). Every scenario row must exist with its own id afterwards;
 * anything missing aborts the project transaction instead of leaving a partial scenario.
 */
async function verifyProject(
  tx: Transaction,
  fixtures: DemoFixtures,
  project: DemoProject,
): Promise<ProjectSeedCounts> {
  const ids = <T extends { projectId: string; id: string }>(items: T[]) =>
    items.filter((item) => item.projectId === project.id).map((item) => item.id);
  const scope = { organizationId: project.organizationId, projectId: project.id };
  const expected = {
    epics: ids(fixtures.epics),
    sprints: ids(fixtures.sprints),
    milestones: ids(fixtures.milestones),
    tasks: ids(fixtures.tasks),
    comments: ids(fixtures.comments),
  };
  const dependencies = fixtures.tasks
    .filter((task) => task.projectId === project.id)
    .flatMap((task) => task.blockedByIds.map((dependsOnId) => ({ taskId: task.id, dependsOnId })));
  const found: ProjectSeedCounts = {
    projects: await tx.project.count({ where: { id: project.id, organizationId: project.organizationId } }),
    epics: await tx.epic.count({ where: { ...scope, id: { in: expected.epics } } }),
    sprints: await tx.sprint.count({ where: { ...scope, id: { in: expected.sprints } } }),
    milestones: await tx.milestone.count({ where: { ...scope, id: { in: expected.milestones } } }),
    tasks: await tx.task.count({ where: { ...scope, id: { in: expected.tasks } } }),
    dependencies: dependencies.length
      ? await tx.taskDependency.count({ where: { ...scope, OR: dependencies } })
      : 0,
    comments: await tx.comment.count({ where: { ...scope, id: { in: expected.comments } } }),
  };
  const missing = (Object.keys(found) as (keyof ProjectSeedCounts)[]).filter((key) => {
    const want = key === "projects" ? 1 : key === "dependencies" ? dependencies.length : expected[key].length;
    return found[key] !== want;
  });
  if (missing.length)
    throw new Error(
      `Demo project ${project.key} could not be written completely (${missing.join(", ")}); ` +
        "another record already uses one of its unique keys",
    );
  return found;
}
