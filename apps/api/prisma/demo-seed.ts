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
  /** `already seeded` when every scenario project already existed, so nothing was written. */
  status: "seeded" | "already seeded";
  /** Rows written by this run; zero everywhere on a repeated run. */
  inserted: ProjectSeedCounts;
  /** Rows of the scenario present after the run, counted by primary key. */
  present: ProjectSeedCounts;
  /** Divergences from the scenario (skipped projects, removed rows); never fatal. */
  warnings: string[];
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
 * Writes the demonstration scenario of ms-projects, one transaction per project, each project
 * only once: a scenario project whose row already exists was seeded by an earlier run (projects
 * cannot be deleted, only archived) and is left untouched, so tasks, comments or sprints people
 * removed afterwards never come back. A project still missing, as after a run interrupted between
 * two projects, is written in full. Rows keep their historical timestamps and refs; the project
 * task sequence continues after the last seeded number. No outbox rows are written: the history of
 * the scenario is seeded into ms-audit directly, and publishing it again would duplicate audit
 * events and fire realtime updates and notifications for things that never happened.
 * Existing rows are never updated or deleted (including the older AXL demonstration project).
 * Divergences never fail the seed: a project key taken by another project skips that project, and
 * scenario rows missing after the run are reported in `warnings`. Database errors still fail it.
 */
export async function seedProjects(db: PrismaClient, fixtures: DemoFixtures): Promise<ProjectSeedReport> {
  const inserted = empty();
  const present = empty();
  const warnings: string[] = [];
  let written = 0;
  for (const project of fixtures.projects) {
    await db.$transaction(
      async (tx) => {
        // serializes concurrent seed runs between the existence check and the inserts
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('axial-projects-demo-seed'))`;
        const existing = await tx.project.findUnique({ where: { id: project.id }, select: { id: true } });
        if (!existing) {
          const clash = await tx.project.findUnique({
            where: { organizationId_key: { organizationId: project.organizationId, key: project.key } },
            select: { id: true },
          });
          if (clash) {
            warnings.push(
              `project ${project.key} (${project.id}) skipped: its key already belongs to project ${clash.id}`,
            );
            return;
          }
          written++;
          const counts = await seedProject(tx, fixtures, project);
          for (const key of Object.keys(inserted) as (keyof ProjectSeedCounts)[])
            inserted[key] += counts[key];
        }
        const totals = await verifyProject(tx, fixtures, project, warnings);
        for (const key of Object.keys(present) as (keyof ProjectSeedCounts)[]) present[key] += totals[key];
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }
  return { status: written ? "seeded" : "already seeded", inserted, present, warnings };
}

async function seedProject(
  tx: Transaction,
  fixtures: DemoFixtures,
  project: DemoProject,
): Promise<ProjectSeedCounts> {
  const owned = <T extends { projectId: string }>(items: T[]) =>
    items.filter((item) => item.projectId === project.id);
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
 * Scenario rows of the project present now, each counted by its primary key. A shortfall is a
 * divergence, not an error: rows removed after the first run, or rows `skipDuplicates` left out
 * because another record took one of their unique keys (a ref, for example). It is reported in
 * `warnings` and nothing is restored.
 */
async function verifyProject(
  tx: Transaction,
  fixtures: DemoFixtures,
  project: DemoProject,
  warnings: string[],
): Promise<ProjectSeedCounts> {
  const ids = <T extends { projectId: string; id: string }>(items: T[]) =>
    items.filter((item) => item.projectId === project.id).map((item) => item.id);
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
    projects: await tx.project.count({ where: { id: project.id } }),
    epics: await tx.epic.count({ where: { id: { in: expected.epics } } }),
    sprints: await tx.sprint.count({ where: { id: { in: expected.sprints } } }),
    milestones: await tx.milestone.count({ where: { id: { in: expected.milestones } } }),
    tasks: await tx.task.count({ where: { id: { in: expected.tasks } } }),
    dependencies: dependencies.length ? await tx.taskDependency.count({ where: { OR: dependencies } }) : 0,
    comments: await tx.comment.count({ where: { id: { in: expected.comments } } }),
  };
  const missing = (Object.keys(found) as (keyof ProjectSeedCounts)[]).flatMap((key) => {
    const want = key === "projects" ? 1 : key === "dependencies" ? dependencies.length : expected[key].length;
    return found[key] < want ? [`${key} ${found[key]} of ${want}`] : [];
  });
  if (missing.length)
    warnings.push(
      `project ${project.key}: scenario rows present: ${missing.join(", ")}; missing rows are not restored`,
    );
  return found;
}
