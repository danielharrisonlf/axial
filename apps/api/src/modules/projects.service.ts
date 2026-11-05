import type {
  AuthContext,
  CreateComment,
  CreateEpic,
  CreateMilestone,
  CreateProject,
  CreateSprint,
  CreateTask,
  DomainEventType,
  MoveTask,
  Pagination,
  ProjectList,
  TaskList,
  UpdateComment,
  UpdateEpic,
  UpdateMilestone,
  UpdateProject,
  UpdateSprint,
  UpdateTask,
} from "@axial/contracts";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, Project, Task } from "../generated/prisma/client.js";
import { isManager, ProjectsRepository, type Transaction } from "./projects.repository.js";

const pageArgs = ({ page, pageSize }: Pagination) => ({ skip: (page - 1) * pageSize, take: pageSize });
const paged = <T>(items: T[], total: number, query: Pagination) => ({
  items,
  total,
  page: query.page,
  pageSize: query.pageSize,
});
const dates = (start: Date | string | null | undefined, end: Date | string | null | undefined) => {
  if (start && end && new Date(start).getTime() > new Date(end).getTime())
    throw new BadRequestException("Start date must be on or before end date");
};
const sprintDates = (start: Date | string, end: Date | string) => {
  if (new Date(start).getTime() >= new Date(end).getTime())
    throw new BadRequestException("Sprint start date must be before its end date");
};
const version = (entity: { version: number }, expected: number) => {
  if (entity.version !== expected) throw new ConflictException("Version conflict; reload the resource");
};
const taskInclude = { dependencies: { select: { dependsOnId: true } } } satisfies Prisma.TaskInclude;

@Injectable()
export class ProjectsService {
  constructor(@Inject(ProjectsRepository) private readonly repo: ProjectsRepository) {}

  private manage(actor: AuthContext, project: Project) {
    if (
      !isManager(actor) &&
      !(actor.role === "TEAM_LEAD" && project.teamIds.some((id) => actor.teamIds.includes(id)))
    )
      throw new ForbiddenException("Project management permission required");
  }
  private member(actor: AuthContext) {
    if (actor.role === "VIEWER") throw new ForbiddenException("Read only role");
  }
  private user(actor: AuthContext, id: string | null | undefined) {
    if (id && id !== actor.userId && !actor.assignableUserIds.includes(id))
      throw new BadRequestException("User is not assignable in this organization");
  }
  private teams(actor: AuthContext, ids: string[] | undefined) {
    if (ids?.some((id) => !actor.assignableTeamIds.includes(id)))
      throw new BadRequestException("Team is not assignable in this organization");
  }
  private taskPermission(actor: AuthContext, task: Task, changes: object) {
    this.member(actor);
    if (isManager(actor)) return;
    if (actor.role === "TEAM_LEAD") {
      if (!task.teamId || !actor.teamIds.includes(task.teamId))
        throw new ForbiddenException("Task is outside your teams");
      return;
    }
    if (actor.role !== "CONTRIBUTOR" || task.assigneeId !== actor.userId)
      throw new ForbiddenException("Only assigned tasks can be edited");
    const allowed = new Set(["version", "title", "description", "status", "acceptanceCriteria"]);
    if (Object.keys(changes).some((key) => !allowed.has(key)))
      throw new ForbiddenException("Contributors cannot change assignment or planning");
  }
  private async task(actor: AuthContext, id: string, tx: Transaction = this.repo.db) {
    const task = await tx.task.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException("Task not found");
    const project = await this.repo.project(actor, task.projectId, tx);
    return { task, project };
  }
  private async epic(actor: AuthContext, id: string, tx: Transaction = this.repo.db) {
    const epic = await tx.epic.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!epic) throw new NotFoundException("Epic not found");
    return { epic, project: await this.repo.project(actor, epic.projectId, tx) };
  }
  private async sprint(actor: AuthContext, id: string, tx: Transaction = this.repo.db) {
    const sprint = await tx.sprint.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!sprint) throw new NotFoundException("Sprint not found");
    return { sprint, project: await this.repo.project(actor, sprint.projectId, tx) };
  }
  private async milestone(actor: AuthContext, id: string, tx: Transaction = this.repo.db) {
    const milestone = await tx.milestone.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!milestone) throw new NotFoundException("Milestone not found");
    return { milestone, project: await this.repo.project(actor, milestone.projectId, tx) };
  }
  private async comment(actor: AuthContext, id: string, tx: Transaction = this.repo.db) {
    const comment = await tx.comment.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!comment) throw new NotFoundException("Comment not found");
    return { comment, project: await this.repo.project(actor, comment.projectId, tx) };
  }
  private async emit(
    tx: Transaction,
    actor: AuthContext,
    projectId: string,
    kind: string,
    event: DomainEventType,
    before: { id: string; version: number } | null,
    after: { id: string; version: number } | null,
  ) {
    const entity = after ?? before;
    if (!entity) throw new Error("An event requires an aggregate");
    await this.repo.event(
      tx,
      actor,
      projectId,
      kind,
      entity.id,
      after ? after.version : entity.version + 1,
      event,
      before,
      after,
    );
  }

  async listProjects(actor: AuthContext, query: ProjectList) {
    const where: Prisma.ProjectWhereInput = {
      ...this.repo.scope(actor),
      archivedAt: query.archived === "true" ? { not: null } : null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { key: { contains: query.search, mode: "insensitive" } },
            ],
            AND: [this.repo.scope(actor)],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.repo.db.project.findMany({
        where,
        ...pageArgs(query),
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      this.repo.db.project.count({ where }),
    ]);
    return paged(items, total, query);
  }
  getProject(actor: AuthContext, id: string) {
    return this.repo.project(actor, id);
  }
  async createProject(actor: AuthContext, input: CreateProject) {
    if (!isManager(actor)) throw new ForbiddenException("Only managers can create projects");
    this.user(actor, input.leadId);
    this.teams(actor, input.teamIds);
    dates(input.startDate, input.endDate);
    return this.repo.transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          ...input,
          teamIds: [...new Set(input.teamIds)],
          organizationId: actor.organizationId,
          createdBy: actor.userId,
        },
      });
      await this.emit(tx, actor, project.id, "project", "project.created", null, project);
      return project;
    });
  }
  updateProject(actor: AuthContext, id: string, input: UpdateProject) {
    return this.repo.mutate(actor, id, async (tx, before) => {
      this.manage(actor, before);
      version(before, input.version);
      if (!isManager(actor) && ("teamIds" in input || "leadId" in input))
        throw new ForbiddenException("Only managers can change project membership");
      this.user(actor, input.leadId);
      this.teams(actor, input.teamIds);
      dates(
        input.startDate === undefined ? before.startDate : input.startDate,
        input.endDate === undefined ? before.endDate : input.endDate,
      );
      if (input.teamIds) {
        const detached = await tx.task.count({
          where: {
            projectId: id,
            organizationId: actor.organizationId,
            teamId: { not: null, notIn: input.teamIds },
          },
        });
        if (detached) throw new ConflictException("Project teams are still assigned to tasks");
      }
      const { version: _, ...data } = input;
      const after = await tx.project.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await this.emit(tx, actor, id, "project", "project.updated", before, after);
      return after;
    });
  }
  archiveProject(actor: AuthContext, id: string, expected: number, restore = false) {
    return this.repo.mutate(
      actor,
      id,
      async (tx, before) => {
        if (!isManager(actor)) throw new ForbiddenException("Only managers can archive or restore projects");
        version(before, expected);
        if (restore ? !before.archivedAt : !!before.archivedAt)
          throw new ConflictException(restore ? "Project is not archived" : "Project is already archived");
        const after = await tx.project.update({
          where: { id },
          data: { archivedAt: restore ? null : new Date(), version: { increment: 1 } },
        });
        await this.emit(
          tx,
          actor,
          id,
          "project",
          restore ? "project.restored" : "project.archived",
          before,
          after,
        );
        return after;
      },
      true,
    );
  }

  async listEpics(actor: AuthContext, projectId: string, query: Pagination) {
    await this.repo.project(actor, projectId);
    const where = { organizationId: actor.organizationId, projectId };
    const [items, total] = await Promise.all([
      this.repo.db.epic.findMany({
        where,
        ...pageArgs(query),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.repo.db.epic.count({ where }),
    ]);
    return paged(items, total, query);
  }
  async getEpic(actor: AuthContext, id: string) {
    return (await this.epic(actor, id)).epic;
  }
  createEpic(actor: AuthContext, projectId: string, input: CreateEpic) {
    return this.repo.mutate(actor, projectId, async (tx, project) => {
      this.manage(actor, project);
      this.user(actor, input.ownerId);
      const after = await tx.epic.create({
        data: { ...input, projectId, organizationId: actor.organizationId },
      });
      await this.emit(tx, actor, projectId, "epic", "epic.created", null, after);
      return after;
    });
  }
  async updateEpic(actor: AuthContext, id: string, input: UpdateEpic) {
    const initial = await this.epic(actor, id);
    return this.repo.mutate(actor, initial.epic.projectId, async (tx, project) => {
      this.manage(actor, project);
      const { epic: before } = await this.epic(actor, id, tx);
      version(before, input.version);
      this.user(actor, input.ownerId);
      const { version: _, ...data } = input;
      const after = await tx.epic.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await this.emit(tx, actor, project.id, "epic", "epic.updated", before, after);
      return after;
    });
  }
  async deleteEpic(actor: AuthContext, id: string, expected: number) {
    const initial = await this.epic(actor, id);
    return this.repo.mutate(actor, initial.epic.projectId, async (tx, project) => {
      this.manage(actor, project);
      const { epic: before } = await this.epic(actor, id, tx);
      version(before, expected);
      if (await tx.task.count({ where: { epicId: id, organizationId: actor.organizationId } }))
        throw new ConflictException("Epic still has tasks");
      await tx.epic.delete({ where: { id } });
      await this.emit(tx, actor, project.id, "epic", "epic.deleted", before, null);
      return { id, deleted: true };
    });
  }

  private taskWhere(actor: AuthContext, projectId: string, query: TaskList): Prisma.TaskWhereInput {
    return {
      organizationId: actor.organizationId,
      projectId,
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" } },
              { ref: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.teamId ? { teamId: query.teamId } : {}),
      ...(query.epicId ? { epicId: query.epicId } : {}),
      ...(query.sprintId ? { sprintId: query.sprintId } : {}),
      ...(query.parentId ? { parentId: query.parentId } : {}),
      ...(query.label ? { labels: { has: query.label } } : {}),
    };
  }
  async listTasks(actor: AuthContext, projectId: string, query: TaskList, backlog = false) {
    await this.repo.project(actor, projectId);
    const where: Prisma.TaskWhereInput = {
      AND: [
        this.taskWhere(actor, projectId, query),
        ...(backlog ? [{ sprintId: null, status: { not: "done" } }] : []),
      ],
    };
    const [items, total] = await Promise.all([
      this.repo.db.task.findMany({
        where,
        include: taskInclude,
        ...pageArgs(query),
        orderBy: [{ position: "asc" }, { number: "asc" }],
      }),
      this.repo.db.task.count({ where }),
    ]);
    return paged(items, total, query);
  }
  async getTask(actor: AuthContext, id: string) {
    return (await this.task(actor, id)).task;
  }
  private async taskReferences(
    tx: Transaction,
    actor: AuthContext,
    project: Project,
    input: Partial<CreateTask>,
    current?: Task,
  ) {
    this.user(actor, input.assigneeId);
    if (input.teamId) {
      this.teams(actor, [input.teamId]);
      if (!project.teamIds.includes(input.teamId))
        throw new BadRequestException("Task team must belong to the project");
      if (actor.role === "TEAM_LEAD" && !actor.teamIds.includes(input.teamId))
        throw new ForbiddenException("Task team is outside your teams");
    }
    const where = { organizationId: actor.organizationId, projectId: project.id };
    if (input.epicId && !(await tx.epic.findFirst({ where: { ...where, id: input.epicId } })))
      throw new NotFoundException("Epic not found in project");
    if (input.sprintId) {
      const sprint = await tx.sprint.findFirst({ where: { ...where, id: input.sprintId } });
      if (!sprint) throw new NotFoundException("Sprint not found in project");
      if (sprint.status === "done" && input.sprintId !== current?.sprintId)
        throw new ConflictException("Cannot assign tasks to a completed sprint");
    }
    if (current?.sprintId) {
      const sprint = await tx.sprint.findFirst({ where: { ...where, id: current.sprintId } });
      if (sprint?.status === "done") throw new ConflictException("Tasks in completed sprints are immutable");
    }
    if (input.parentId) {
      const parent = await tx.task.findFirst({ where: { ...where, id: input.parentId } });
      if (!parent) throw new NotFoundException("Parent task not found in project");
      if (parent.parentId || parent.type === "subtask")
        throw new BadRequestException("Subtasks can only have a top-level task or bug parent");
      if (parent.status === "done" && input.status !== "done")
        throw new ConflictException("Cannot add an unfinished subtask to a completed parent");
    }
    dates(
      input.startDate === undefined ? current?.startDate : input.startDate,
      input.dueDate === undefined ? current?.dueDate : input.dueDate,
    );
    if (input.blockedByIds)
      await this.dependencies(tx, actor, project.id, current?.id, input.blockedByIds, input.parentId);
  }
  private async dependencies(
    tx: Transaction,
    actor: AuthContext,
    projectId: string,
    taskId: string | undefined,
    ids: string[],
    parentId?: string | null,
  ) {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) throw new BadRequestException("Dependencies must be unique");
    if (taskId && ids.includes(taskId)) throw new BadRequestException("A task cannot depend on itself");
    if (!taskId && parentId && ids.includes(parentId))
      throw new ConflictException("A subtask cannot depend on its parent");
    const tasks = await tx.task.count({
      where: { id: { in: ids }, organizationId: actor.organizationId, projectId },
    });
    if (tasks !== ids.length) throw new NotFoundException("Dependency task not found in project");
    const cycleTarget = taskId ?? parentId;
    if (cycleTarget && ids.length) {
      const cycle = await tx.$queryRaw<Array<{ cycle: boolean }>>`
        WITH RECURSIVE edges AS (
          SELECT "taskId", "dependsOnId" FROM "projects"."TaskDependency"
          WHERE "organizationId" = ${actor.organizationId}::uuid AND "projectId" = ${projectId}::uuid
          UNION ALL
          SELECT "parentId" AS "taskId", "id" AS "dependsOnId" FROM "projects"."Task"
          WHERE "organizationId" = ${actor.organizationId}::uuid AND "projectId" = ${projectId}::uuid AND "parentId" IS NOT NULL
        ), ancestors AS (
          SELECT "dependsOnId" FROM edges WHERE "taskId" = ANY(${ids}::uuid[])
          UNION
          SELECT d."dependsOnId" FROM edges d JOIN ancestors a ON d."taskId" = a."dependsOnId"
        ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE "dependsOnId" = ${cycleTarget}::uuid) AS cycle`;
      if (cycle[0]?.cycle) throw new ConflictException("Dependency cycle is not allowed");
    }
  }
  private async completion(
    tx: Transaction,
    actor: AuthContext,
    projectId: string,
    taskId: string | undefined,
    status: string,
    blockedByIds?: string[],
  ) {
    if (status !== "done") return;
    if (
      taskId &&
      (await tx.task.count({
        where: { organizationId: actor.organizationId, projectId, parentId: taskId, status: { not: "done" } },
      }))
    )
      throw new ConflictException("Complete all subtasks first");
    const blockers =
      blockedByIds ??
      (taskId
        ? (
            await tx.taskDependency.findMany({
              where: { taskId, organizationId: actor.organizationId, projectId },
              select: { dependsOnId: true },
            })
          ).map((d) => d.dependsOnId)
        : []);
    if (
      await tx.task.count({
        where: {
          organizationId: actor.organizationId,
          projectId,
          id: { in: blockers },
          status: { not: "done" },
        },
      })
    )
      throw new ConflictException("Complete all blocking tasks first");
  }
  createTask(actor: AuthContext, projectId: string, input: CreateTask) {
    return this.repo.mutate(actor, projectId, async (tx, project) => {
      this.manage(actor, project);
      if ((input.type === "subtask") !== !!input.parentId)
        throw new BadRequestException("Subtask type and parentId must be supplied together");
      if (actor.role === "TEAM_LEAD" && (!input.teamId || !actor.teamIds.includes(input.teamId)))
        throw new ForbiddenException("Team leads must create tasks in their teams");
      await this.taskReferences(tx, actor, project, input);
      await this.completion(tx, actor, projectId, undefined, input.status, input.blockedByIds);
      const seq = await tx.project.update({
        where: { id: projectId },
        data: { taskSequence: { increment: 1 } },
        select: { taskSequence: true },
      });
      const { blockedByIds, ...data } = input;
      const after = await tx.task.create({
        data: {
          ...data,
          organizationId: actor.organizationId,
          projectId,
          number: seq.taskSequence,
          ref: `${project.key}-${seq.taskSequence}`,
          createdBy: actor.userId,
          completedAt: input.status === "done" ? new Date() : null,
        },
      });
      if (blockedByIds.length)
        await tx.taskDependency.createMany({
          data: blockedByIds.map((dependsOnId) => ({
            taskId: after.id,
            dependsOnId,
            organizationId: actor.organizationId,
            projectId,
          })),
        });
      const result = await tx.task.findUniqueOrThrow({ where: { id: after.id }, include: taskInclude });
      await this.emit(tx, actor, projectId, "task", "task.created", null, result);
      return result;
    });
  }
  async updateTask(actor: AuthContext, id: string, input: UpdateTask | MoveTask, transition = false) {
    const initial = await this.task(actor, id);
    return this.repo.mutate(actor, initial.task.projectId, async (tx, project) => {
      const { task: before } = await this.task(actor, id, tx);
      this.taskPermission(actor, before, input);
      version(before, input.version);
      await this.taskReferences(tx, actor, project, input, before);
      const { version: _, ...changes } = input;
      const blockedByIds = "blockedByIds" in changes ? changes.blockedByIds : undefined;
      const { blockedByIds: __, ...data } = changes as Omit<UpdateTask, "version">;
      const targetStatus = data.status ?? before.status;
      await this.completion(tx, actor, project.id, id, targetStatus, blockedByIds);
      if (before.status === "done" && targetStatus !== "done") {
        if (
          before.parentId &&
          (await tx.task.count({
            where: { id: before.parentId, organizationId: actor.organizationId, status: "done" },
          }))
        )
          throw new ConflictException("Reopen the parent before reopening this subtask");
        if (
          await tx.taskDependency.count({
            where: { dependsOnId: id, organizationId: actor.organizationId, task: { status: "done" } },
          })
        )
          throw new ConflictException("Reopen completed dependent tasks first");
      }
      await tx.task.update({
        where: { id },
        data: {
          ...data,
          completedAt: targetStatus === "done" ? (before.completedAt ?? new Date()) : null,
          version: { increment: 1 },
        },
      });
      if (blockedByIds) {
        await tx.taskDependency.deleteMany({ where: { taskId: id, organizationId: actor.organizationId } });
        if (blockedByIds.length)
          await tx.taskDependency.createMany({
            data: blockedByIds.map((dependsOnId) => ({
              taskId: id,
              dependsOnId,
              organizationId: actor.organizationId,
              projectId: project.id,
            })),
          });
      }
      const after = await tx.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
      const event: DomainEventType =
        targetStatus !== before.status
          ? targetStatus === "done"
            ? "task.completed"
            : "task.status_changed"
          : data.assigneeId !== undefined && data.assigneeId !== before.assigneeId
            ? "task.assigned"
            : transition
              ? "task.status_changed"
              : "task.updated";
      await this.emit(tx, actor, project.id, "task", event, before, after);
      return after;
    });
  }
  async deleteTask(actor: AuthContext, id: string, expected: number) {
    const initial = await this.task(actor, id);
    return this.repo.mutate(actor, initial.task.projectId, async (tx, project) => {
      const { task: before } = await this.task(actor, id, tx);
      this.manage(actor, project);
      if (actor.role === "TEAM_LEAD" && (!before.teamId || !actor.teamIds.includes(before.teamId)))
        throw new ForbiddenException("Task is outside your teams");
      version(before, expected);
      await this.taskReferences(tx, actor, project, {}, before);
      const [children, comments, dependents] = await Promise.all([
        tx.task.count({ where: { parentId: id, organizationId: actor.organizationId } }),
        tx.comment.count({ where: { taskId: id, organizationId: actor.organizationId } }),
        tx.taskDependency.count({ where: { dependsOnId: id, organizationId: actor.organizationId } }),
      ]);
      if (children || comments || dependents)
        throw new ConflictException("Task has subtasks, comments or dependents");
      await tx.task.delete({ where: { id } });
      await this.emit(tx, actor, project.id, "task", "task.deleted", before, null);
      return { id, deleted: true };
    });
  }

  async board(actor: AuthContext, projectId: string, query: TaskList) {
    await this.repo.project(actor, projectId);
    const statuses = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
    const columns = await Promise.all(
      statuses.map(async (status) => {
        const where = { AND: [this.taskWhere(actor, projectId, query), { status }] };
        const [items, total] = await Promise.all([
          this.repo.db.task.findMany({
            where,
            include: taskInclude,
            ...pageArgs(query),
            orderBy: [{ position: "asc" }, { number: "asc" }],
          }),
          this.repo.db.task.count({ where }),
        ]);
        return { status, ...paged(items, total, query) };
      }),
    );
    return { projectId, columns };
  }
  async summary(actor: AuthContext, projectId: string) {
    await this.repo.project(actor, projectId);
    const where = { projectId, organizationId: actor.organizationId, parentId: null };
    const [groups, overdue, estimate, doneEstimate] = await Promise.all([
      this.repo.db.task.groupBy({ by: ["status"], where, _count: { _all: true } }),
      this.repo.db.task.count({ where: { ...where, status: { not: "done" }, dueDate: { lt: new Date() } } }),
      this.repo.db.task.aggregate({ where, _sum: { estimate: true } }),
      this.repo.db.task.aggregate({ where: { ...where, status: "done" }, _sum: { estimate: true } }),
    ]);
    const byStatus = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
    const total = groups.reduce((sum, group) => sum + group._count._all, 0);
    const done = byStatus.done ?? 0;
    return {
      projectId,
      total,
      done,
      byStatus,
      overdue,
      completionPercent: total ? Math.round((done * 10000) / total) / 100 : 0,
      estimatedPoints: estimate._sum.estimate ?? 0,
      completedPoints: doneEstimate._sum.estimate ?? 0,
    };
  }
  async timeline(actor: AuthContext, projectId: string, query: Pagination) {
    const project = await this.repo.project(actor, projectId);
    const where = { projectId, organizationId: actor.organizationId };
    const [tasks, taskCount, sprints, sprintCount, milestones, milestoneCount] = await Promise.all([
      this.repo.db.task.findMany({
        where: { ...where, OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] },
        ...pageArgs(query),
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
      }),
      this.repo.db.task.count({
        where: { ...where, OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] },
      }),
      this.repo.db.sprint.findMany({
        where,
        ...pageArgs(query),
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
      }),
      this.repo.db.sprint.count({ where }),
      this.repo.db.milestone.findMany({
        where,
        ...pageArgs(query),
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
      this.repo.db.milestone.count({ where }),
    ]);
    return {
      project,
      tasks: paged(tasks, taskCount, query),
      sprints: paged(sprints, sprintCount, query),
      milestones: paged(milestones, milestoneCount, query),
    };
  }

  async listSprints(actor: AuthContext, projectId: string, query: Pagination) {
    await this.repo.project(actor, projectId);
    const where = { projectId, organizationId: actor.organizationId };
    const [items, total] = await Promise.all([
      this.repo.db.sprint.findMany({
        where,
        ...pageArgs(query),
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
      }),
      this.repo.db.sprint.count({ where }),
    ]);
    return paged(items, total, query);
  }
  async getSprint(actor: AuthContext, id: string) {
    return (await this.sprint(actor, id)).sprint;
  }
  createSprint(actor: AuthContext, projectId: string, input: CreateSprint) {
    return this.repo.mutate(actor, projectId, async (tx, project) => {
      this.manage(actor, project);
      sprintDates(input.startDate, input.endDate);
      const after = await tx.sprint.create({
        data: { ...input, projectId, organizationId: actor.organizationId },
      });
      await this.emit(tx, actor, projectId, "sprint", "sprint.created", null, after);
      return after;
    });
  }
  async updateSprint(actor: AuthContext, id: string, input: UpdateSprint) {
    const initial = await this.sprint(actor, id);
    return this.repo.mutate(actor, initial.sprint.projectId, async (tx, project) => {
      this.manage(actor, project);
      const { sprint: before } = await this.sprint(actor, id, tx);
      version(before, input.version);
      if (before.status === "done") throw new ConflictException("Completed sprints are immutable");
      sprintDates(input.startDate ?? before.startDate, input.endDate ?? before.endDate);
      const { version: _, ...data } = input;
      const after = await tx.sprint.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await this.emit(tx, actor, project.id, "sprint", "sprint.updated", before, after);
      return after;
    });
  }
  async startSprint(actor: AuthContext, id: string, expected: number) {
    const initial = await this.sprint(actor, id);
    return this.repo.mutate(actor, initial.sprint.projectId, async (tx, project) => {
      this.manage(actor, project);
      const { sprint: before } = await this.sprint(actor, id, tx);
      version(before, expected);
      if (before.status !== "planned") throw new ConflictException("Only planned sprints can start");
      if (
        await tx.sprint.count({
          where: { projectId: project.id, organizationId: actor.organizationId, status: "active" },
        })
      )
        throw new ConflictException("Project already has an active sprint");
      const after = await tx.sprint.update({
        where: { id },
        data: { status: "active", startedAt: new Date(), version: { increment: 1 } },
      });
      await this.emit(tx, actor, project.id, "sprint", "sprint.started", before, after);
      return after;
    });
  }
  async completeSprint(actor: AuthContext, id: string, expected: number) {
    const initial = await this.sprint(actor, id);
    return this.repo.mutate(actor, initial.sprint.projectId, async (tx, project) => {
      this.manage(actor, project);
      const { sprint: before } = await this.sprint(actor, id, tx);
      version(before, expected);
      if (before.status !== "active") throw new ConflictException("Only active sprints can complete");
      // Process in bounded batches so large sprints do not produce an unbounded result set.
      let moved = 0;
      for (;;) {
        const tasks = await tx.task.findMany({
          where: {
            organizationId: actor.organizationId,
            projectId: project.id,
            sprintId: id,
            status: { not: "done" },
          },
          take: 100,
          orderBy: { id: "asc" },
          include: taskInclude,
        });
        if (!tasks.length) break;
        for (const task of tasks) {
          const after = await tx.task.update({
            where: { id: task.id },
            data: { sprintId: null, status: "backlog", completedAt: null, version: { increment: 1 } },
            include: taskInclude,
          });
          await this.emit(tx, actor, project.id, "task", "task.updated", task, after);
          moved++;
        }
      }
      const after = await tx.sprint.update({
        where: { id },
        data: { status: "done", completedAt: new Date(), version: { increment: 1 } },
      });
      await this.emit(tx, actor, project.id, "sprint", "sprint.completed", before, after);
      return { ...after, movedToBacklog: moved };
    });
  }
  async deleteSprint(actor: AuthContext, id: string, expected: number) {
    const initial = await this.sprint(actor, id);
    return this.repo.mutate(actor, initial.sprint.projectId, async (tx, project) => {
      this.manage(actor, project);
      const { sprint: before } = await this.sprint(actor, id, tx);
      version(before, expected);
      if (before.status !== "planned") throw new ConflictException("Only planned sprints can be deleted");
      if (await tx.task.count({ where: { organizationId: actor.organizationId, sprintId: id } }))
        throw new ConflictException("Sprint still has tasks");
      await tx.sprint.delete({ where: { id } });
      await this.emit(tx, actor, project.id, "sprint", "sprint.deleted", before, null);
      return { id, deleted: true };
    });
  }

  async listComments(actor: AuthContext, taskId: string, query: Pagination) {
    await this.task(actor, taskId);
    const where = { taskId, organizationId: actor.organizationId };
    const [items, total] = await Promise.all([
      this.repo.db.comment.findMany({
        where,
        ...pageArgs(query),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.repo.db.comment.count({ where }),
    ]);
    return paged(items, total, query);
  }
  async createComment(actor: AuthContext, taskId: string, input: CreateComment) {
    const initial = await this.task(actor, taskId);
    return this.repo.mutate(actor, initial.task.projectId, async (tx, project) => {
      this.member(actor);
      await this.task(actor, taskId, tx);
      const after = await tx.comment.create({
        data: {
          ...input,
          taskId,
          projectId: project.id,
          organizationId: actor.organizationId,
          authorId: actor.userId,
        },
      });
      await this.emit(tx, actor, project.id, "comment", "comment.created", null, after);
      return after;
    });
  }
  async updateComment(actor: AuthContext, id: string, input: UpdateComment) {
    const initial = await this.comment(actor, id);
    return this.repo.mutate(actor, initial.comment.projectId, async (tx, project) => {
      this.member(actor);
      const { comment: before } = await this.comment(actor, id, tx);
      version(before, input.version);
      if (before.authorId !== actor.userId && !isManager(actor))
        throw new ForbiddenException("Only the author or a manager can edit a comment");
      const after = await tx.comment.update({
        where: { id },
        data: { body: input.body, version: { increment: 1 } },
      });
      await this.emit(tx, actor, project.id, "comment", "comment.updated", before, after);
      return after;
    });
  }
  async deleteComment(actor: AuthContext, id: string, expected: number) {
    const initial = await this.comment(actor, id);
    return this.repo.mutate(actor, initial.comment.projectId, async (tx, project) => {
      this.member(actor);
      const { comment: before } = await this.comment(actor, id, tx);
      version(before, expected);
      if (before.authorId !== actor.userId && !isManager(actor))
        throw new ForbiddenException("Only the author or a manager can delete a comment");
      await tx.comment.delete({ where: { id } });
      await this.emit(tx, actor, project.id, "comment", "comment.deleted", before, null);
      return { id, deleted: true };
    });
  }

  async listMilestones(actor: AuthContext, projectId: string, query: Pagination) {
    await this.repo.project(actor, projectId);
    const where = { organizationId: actor.organizationId, projectId };
    const [items, total] = await Promise.all([
      this.repo.db.milestone.findMany({
        where,
        ...pageArgs(query),
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
      this.repo.db.milestone.count({ where }),
    ]);
    return paged(items, total, query);
  }
  async getMilestone(actor: AuthContext, id: string) {
    return (await this.milestone(actor, id)).milestone;
  }
  createMilestone(actor: AuthContext, projectId: string, input: CreateMilestone) {
    return this.repo.mutate(actor, projectId, async (tx, project) => {
      this.manage(actor, project);
      const after = await tx.milestone.create({
        data: { ...input, projectId, organizationId: actor.organizationId },
      });
      await this.emit(tx, actor, projectId, "milestone", "milestone.created", null, after);
      return after;
    });
  }
  async updateMilestone(actor: AuthContext, id: string, input: UpdateMilestone) {
    const initial = await this.milestone(actor, id);
    return this.repo.mutate(actor, initial.milestone.projectId, async (tx, project) => {
      this.manage(actor, project);
      const { milestone: before } = await this.milestone(actor, id, tx);
      version(before, input.version);
      const { version: _, completed, ...data } = input;
      const after = await tx.milestone.update({
        where: { id },
        data: {
          ...data,
          ...(completed === undefined
            ? {}
            : { completedAt: completed ? (before.completedAt ?? new Date()) : null }),
          version: { increment: 1 },
        },
      });
      await this.emit(tx, actor, project.id, "milestone", "milestone.updated", before, after);
      return after;
    });
  }
  async deleteMilestone(actor: AuthContext, id: string, expected: number) {
    const initial = await this.milestone(actor, id);
    return this.repo.mutate(actor, initial.milestone.projectId, async (tx, project) => {
      this.manage(actor, project);
      const { milestone: before } = await this.milestone(actor, id, tx);
      version(before, expected);
      await tx.milestone.delete({ where: { id } });
      await this.emit(tx, actor, project.id, "milestone", "milestone.deleted", before, null);
      return { id, deleted: true };
    });
  }
}
