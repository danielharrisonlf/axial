import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../src/infra/database/prisma.service.js";
import { ProjectsRepository } from "../../src/modules/projects.repository.js";
import { startTestApp, uuid } from "../support/app-harness.js";

const base = "/api/v1";
const startDate = "2026-11-01T12:00:00.000Z";
const endDate = "2026-11-14T12:00:00.000Z";

describe("projects HTTP acceptance with PostgreSQL", () => {
  let harness: Awaited<ReturnType<typeof startTestApp>>;
  let prisma: PrismaService;
  let organizationId: string;
  let userId: string;
  let token: string;
  let organizations: string[];
  const api = () => request(harness.app.getHttpServer());
  const createProject = async (key = "TEST", bearer = token) =>
    (
      await api()
        .post(`${base}/projects`)
        .auth(bearer, { type: "bearer" })
        .send({ key, name: "Acceptance project" })
        .expect(201)
    ).body;
  const createTask = async (projectId: string, body: Record<string, unknown> = {}) =>
    (
      await api()
        .post(`${base}/projects/${projectId}/tasks`)
        .auth(token, { type: "bearer" })
        .send({ title: "Acceptance task", ...body })
        .expect(201)
    ).body;

  beforeAll(async () => {
    harness = await startTestApp();
    prisma = harness.app.get(PrismaService);
  });
  beforeEach(async () => {
    organizationId = uuid();
    userId = uuid();
    organizations = [organizationId];
    token = await harness.token({ organizationId, userId });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    const where = { organizationId: { in: organizations } };
    await prisma.comment.deleteMany({ where });
    await prisma.taskDependency.deleteMany({ where });
    await prisma.task.deleteMany({ where: { ...where, parentId: { not: null } } });
    await prisma.task.deleteMany({ where });
    await prisma.epic.deleteMany({ where });
    await prisma.sprint.deleteMany({ where });
    await prisma.milestone.deleteMany({ where });
    await prisma.project.deleteMany({ where });
    await prisma.outboxEvent.deleteMany({ where });
  });
  afterAll(async () => {
    await harness?.close();
  });

  it("executes project, epic, sprint, task/subtask, comment and reporting flow with transactional audit metadata", async () => {
    const project = await createProject();
    const epic = (
      await api()
        .post(`${base}/projects/${project.id}/epics`)
        .auth(token, { type: "bearer" })
        .send({ title: "Launch" })
        .expect(201)
    ).body;
    let sprint = (
      await api()
        .post(`${base}/projects/${project.id}/sprints`)
        .auth(token, { type: "bearer" })
        .send({ name: "Sprint 1", startDate, endDate })
        .expect(201)
    ).body;
    const task = await createTask(project.id, {
      epicId: epic.id,
      sprintId: sprint.id,
      estimate: 8,
      dueDate: endDate,
    });
    const child = await createTask(project.id, {
      type: "subtask",
      parentId: task.id,
      sprintId: sprint.id,
      estimate: 100,
    });
    const unfinished = await createTask(project.id, {
      sprintId: sprint.id,
      status: "in_progress",
      estimate: 3,
    });
    expect(task).toMatchObject({ ref: "TEST-1", number: 1, version: 1 });
    const comment = (
      await api()
        .post(`${base}/tasks/${task.id}/comments`)
        .auth(token, { type: "bearer" })
        .send({ body: "Ready for review" })
        .expect(201)
    ).body;
    await api()
      .patch(`${base}/comments/${comment.id}`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, body: "Reviewed" })
      .expect(200);
    expect(
      (await api().get(`${base}/tasks/${task.id}/comments`).auth(token, { type: "bearer" }).expect(200)).body,
    ).toMatchObject({ total: 1, items: [{ body: "Reviewed", version: 2 }] });
    const milestone = (
      await api()
        .post(`${base}/projects/${project.id}/milestones`)
        .auth(token, { type: "bearer" })
        .send({ name: "Release", date: endDate })
        .expect(201)
    ).body;
    await api()
      .patch(`${base}/milestones/${milestone.id}`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, completed: true })
      .expect(200);
    sprint = (
      await api()
        .post(`${base}/sprints/${sprint.id}/start`)
        .auth(token, { type: "bearer" })
        .send({ version: sprint.version })
        .expect(201)
    ).body;
    await api()
      .patch(`${base}/tasks/${task.id}/status`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, status: "done" })
      .expect(409);
    await api()
      .patch(`${base}/tasks/${child.id}/status`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, status: "done" })
      .expect(200);
    const done = (
      await api()
        .patch(`${base}/tasks/${task.id}/status`)
        .auth(token, { type: "bearer" })
        .set("x-correlation-id", "acceptance-completion")
        .send({ version: 1, status: "done" })
        .expect(200)
    ).body;
    await api()
      .patch(`${base}/tasks/${task.id}/status`)
      .auth(token, { type: "bearer" })
      .send({ version: done.version, status: "done" })
      .expect(200);
    expect(
      await prisma.outboxEvent.count({ where: { aggregateId: task.id, eventType: "task.completed" } }),
    ).toBe(1);
    const completion = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: task.id, eventType: "task.completed" },
    });
    expect(completion).toMatchObject({
      organizationId,
      actorId: userId,
      source: "api",
      correlationId: "acceptance-completion",
      publishedAt: null,
    });
    expect(completion.payload).toMatchObject({ before: { status: "backlog" }, after: { status: "done" } });
    const completed = (
      await api()
        .post(`${base}/sprints/${sprint.id}/complete`)
        .auth(token, { type: "bearer" })
        .send({ version: sprint.version })
        .expect(201)
    ).body;
    expect(completed).toMatchObject({ status: "done", movedToBacklog: 1 });
    expect(
      (await api().get(`${base}/tasks/${unfinished.id}`).auth(token, { type: "bearer" }).expect(200)).body,
    ).toMatchObject({ sprintId: null, status: "backlog", version: 2 });
    expect(
      (await api().get(`${base}/projects/${project.id}/backlog`).auth(token, { type: "bearer" }).expect(200))
        .body,
    ).toMatchObject({ total: 1, items: [{ id: unfinished.id }] });
    expect(
      (await api().get(`${base}/projects/${project.id}/summary`).auth(token, { type: "bearer" }).expect(200))
        .body,
    ).toMatchObject({ total: 2, done: 1, completionPercent: 50, estimatedPoints: 11, completedPoints: 8 });
    const timeline = (
      await api().get(`${base}/projects/${project.id}/timeline`).auth(token, { type: "bearer" }).expect(200)
    ).body;
    expect(timeline).toMatchObject({ tasks: { total: 1 }, sprints: { total: 1 }, milestones: { total: 1 } });
    const board = (
      await api().get(`${base}/projects/${project.id}/board`).auth(token, { type: "bearer" }).expect(200)
    ).body;
    expect(board.columns.find((column: { status: string }) => column.status === "done")).toMatchObject({
      total: 2,
    });
  });

  it("isolates tenant IDs, list/search and injected cross-project relations", async () => {
    const project = await createProject();
    const task = await createTask(project.id);
    const otherOrganizationId = uuid();
    organizations.push(otherOrganizationId);
    const otherToken = await harness.token({ organizationId: otherOrganizationId });
    const foreignProject = await createProject("FOREIGN", otherToken);
    const epic = (
      await api()
        .post(`${base}/projects/${foreignProject.id}/epics`)
        .auth(otherToken, { type: "bearer" })
        .send({ title: "Private epic" })
        .expect(201)
    ).body;
    for (const path of [
      `projects/${project.id}`,
      `tasks/${task.id}`,
      `projects/${project.id}/board`,
      `projects/${project.id}/summary`,
    ])
      await api().get(`${base}/${path}`).auth(otherToken, { type: "bearer" }).expect(404);
    await api()
      .patch(`${base}/tasks/${task.id}`)
      .auth(otherToken, { type: "bearer" })
      .send({ version: 1, title: "Attack" })
      .expect(404);
    await api()
      .post(`${base}/projects/${project.id}/tasks`)
      .auth(token, { type: "bearer" })
      .send({ title: "Injected relation", epicId: epic.id })
      .expect(404);
    const foreignTask = (
      await api()
        .post(`${base}/projects/${foreignProject.id}/tasks`)
        .auth(otherToken, { type: "bearer" })
        .send({ title: "Private task" })
        .expect(201)
    ).body;
    const foreignSprint = (
      await api()
        .post(`${base}/projects/${foreignProject.id}/sprints`)
        .auth(otherToken, { type: "bearer" })
        .send({ name: "Private sprint", startDate, endDate })
        .expect(201)
    ).body;
    for (const body of [
      { sprintId: foreignSprint.id },
      { type: "subtask", parentId: foreignTask.id },
      { blockedByIds: [foreignTask.id] },
    ])
      await api()
        .post(`${base}/projects/${project.id}/tasks`)
        .auth(token, { type: "bearer" })
        .send({ title: "Injected relation", ...body })
        .expect(404);
    await api()
      .patch(`${base}/tasks/${task.id}`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, blockedByIds: [uuid()] })
      .expect(404);
    const list = (
      await api().get(`${base}/projects?search=Acceptance`).auth(otherToken, { type: "bearer" }).expect(200)
    ).body;
    expect(list.total).toBe(1);
    expect(list.items[0].id).toBe(foreignProject.id);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      title: "Acceptance task",
      version: 1,
    });
  });

  it("enforces viewer and contributor permissions, trusted assignment and comment ownership", async () => {
    const project = await createProject();
    const task = await createTask(project.id, { assigneeId: userId });
    const viewer = await harness.token({ organizationId, role: "VIEWER", projectIds: [project.id] });
    await api().get(`${base}/projects/${project.id}`).auth(viewer, { type: "bearer" }).expect(200);
    await api()
      .post(`${base}/tasks/${task.id}/comments`)
      .auth(viewer, { type: "bearer" })
      .send({ body: "No write" })
      .expect(403);
    await api()
      .patch(`${base}/tasks/${task.id}`)
      .auth(viewer, { type: "bearer" })
      .send({ version: 1, title: "No write" })
      .expect(403);
    const contributor = await harness.token({
      organizationId,
      userId,
      role: "CONTRIBUTOR",
      projectIds: [project.id],
    });
    await api()
      .patch(`${base}/tasks/${task.id}`)
      .auth(contributor, { type: "bearer" })
      .send({ version: 1, title: "My assigned task" })
      .expect(200);
    await api()
      .patch(`${base}/tasks/${task.id}`)
      .auth(contributor, { type: "bearer" })
      .send({ version: 2, assigneeId: null })
      .expect(403);
    await api()
      .post(`${base}/projects/${project.id}/tasks`)
      .auth(contributor, { type: "bearer" })
      .send({ title: "Not manager" })
      .expect(403);
    await api()
      .post(`${base}/projects/${project.id}/tasks`)
      .auth(token, { type: "bearer" })
      .send({ title: "Unknown identity", assigneeId: uuid() })
      .expect(400);
    const comment = (
      await api()
        .post(`${base}/tasks/${task.id}/comments`)
        .auth(contributor, { type: "bearer" })
        .send({ body: "Owner only" })
        .expect(201)
    ).body;
    const peer = await harness.token({ organizationId, role: "CONTRIBUTOR", projectIds: [project.id] });
    await api()
      .patch(`${base}/comments/${comment.id}`)
      .auth(peer, { type: "bearer" })
      .send({ version: 1, body: "Hijack" })
      .expect(403);
  });

  it("validates unknown fields, dates, missing versions and stale/concurrent writes", async () => {
    await api()
      .post(`${base}/projects`)
      .auth(token, { type: "bearer" })
      .send({ key: "BAD", name: "Mass assignment", organizationId })
      .expect(400);
    await api()
      .post(`${base}/projects`)
      .auth(token, { type: "bearer" })
      .send({ key: "BAD", name: "Dates", startDate: endDate, endDate: startDate })
      .expect(400);
    const project = await createProject();
    await api()
      .patch(`${base}/projects/${project.id}`)
      .auth(token, { type: "bearer" })
      .send({ name: "Missing version" })
      .expect(400);
    await api()
      .post(`${base}/projects/${project.id}/sprints`)
      .auth(token, { type: "bearer" })
      .send({ name: "Invalid", startDate: endDate, endDate: startDate })
      .expect(400);
    const task = await createTask(project.id);
    const responses = await Promise.all(
      ["First writer", "Second writer"].map((title) =>
        api().patch(`${base}/tasks/${task.id}`).auth(token, { type: "bearer" }).send({ version: 1, title }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.outboxEvent.count({ where: { aggregateId: task.id, eventType: "task.updated" } }),
    ).toBe(1);
    await api().get(`${base}/projects?pageSize=101`).auth(token, { type: "bearer" }).expect(400);
    await api().get(`${base}/tasks/not-a-uuid`).auth(token, { type: "bearer" }).expect(400);
  });

  it("rejects cyclic blockers and unfinished dependencies without emitting successful mutations", async () => {
    const project = await createProject();
    const first = await createTask(project.id);
    const second = await createTask(project.id, { blockedByIds: [first.id] });
    await api()
      .patch(`${base}/tasks/${first.id}`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, blockedByIds: [second.id] })
      .expect(409);
    await api()
      .patch(`${base}/tasks/${second.id}/status`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, status: "done" })
      .expect(409);
    await api()
      .patch(`${base}/tasks/${first.id}`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, blockedByIds: [first.id] })
      .expect(400);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: { in: [first.id, second.id] }, eventType: { not: "task.created" } },
      }),
    ).toBe(0);
    await api()
      .patch(`${base}/tasks/${first.id}/status`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, status: "done" })
      .expect(200);
    await api()
      .patch(`${base}/tasks/${second.id}/status`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, status: "done" })
      .expect(200);
    await api()
      .patch(`${base}/tasks/${first.id}/status`)
      .auth(token, { type: "bearer" })
      .send({ version: 2, status: "todo" })
      .expect(409);
  });

  it("serializes competing sprint starts so only one becomes active", async () => {
    const project = await createProject();
    const sprints = [];
    for (const name of ["Sprint A", "Sprint B"])
      sprints.push(
        (
          await api()
            .post(`${base}/projects/${project.id}/sprints`)
            .auth(token, { type: "bearer" })
            .send({ name, startDate, endDate })
            .expect(201)
        ).body,
      );
    const responses = await Promise.all(
      sprints.map((sprint) =>
        api().post(`${base}/sprints/${sprint.id}/start`).auth(token, { type: "bearer" }).send({ version: 1 }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.sprint.count({ where: { projectId: project.id, status: "active" } })).toBe(1);
    expect(
      await prisma.outboxEvent.count({ where: { projectId: project.id, eventType: "sprint.started" } }),
    ).toBe(1);
  });

  it("archives projects, blocks nested writes, and restores with optimistic version checks", async () => {
    const project = await createProject();
    const task = await createTask(project.id);
    const archived = (
      await api()
        .post(`${base}/projects/${project.id}/archive`)
        .auth(token, { type: "bearer" })
        .send({ version: 1 })
        .expect(201)
    ).body;
    expect(archived.archivedAt).toBeTruthy();
    expect((await api().get(`${base}/projects`).auth(token, { type: "bearer" }).expect(200)).body.total).toBe(
      0,
    );
    expect(
      (await api().get(`${base}/projects?archived=true`).auth(token, { type: "bearer" }).expect(200)).body
        .total,
    ).toBe(1);
    await api()
      .patch(`${base}/tasks/${task.id}`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, title: "Archived write" })
      .expect(409);
    await api()
      .post(`${base}/tasks/${task.id}/comments`)
      .auth(token, { type: "bearer" })
      .send({ body: "Archived write" })
      .expect(409);
    await api()
      .post(`${base}/projects/${project.id}/restore`)
      .auth(token, { type: "bearer" })
      .send({ version: 1 })
      .expect(409);
    await api()
      .post(`${base}/projects/${project.id}/restore`)
      .auth(token, { type: "bearer" })
      .send({ version: archived.version })
      .expect(201);
    await api()
      .patch(`${base}/tasks/${task.id}`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, title: "Restored write" })
      .expect(200);
  });

  it("rolls back the aggregate, sequence and event if transactional outbox insertion fails", async () => {
    const project = await createProject();
    const repo = harness.app.get(ProjectsRepository);
    vi.spyOn(repo, "event").mockImplementationOnce(async (transaction) => {
      // A real database insertion failure inside the same transaction, not a mocked transaction.
      await transaction.outboxEvent.create({
        data: {
          organizationId: "invalid-uuid",
          projectId: project.id,
          aggregateType: "task",
          aggregateId: uuid(),
          aggregateVersion: 1,
          eventType: "task.created",
          actorId: userId,
          source: "api",
          correlationId: uuid(),
          payload: { before: null, after: {} },
        },
      });
    });
    await api()
      .post(`${base}/projects/${project.id}/tasks`)
      .auth(token, { type: "bearer" })
      .send({ title: "Must roll back" })
      .expect(500);
    expect(await prisma.task.count({ where: { projectId: project.id } })).toBe(0);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).taskSequence).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { projectId: project.id } })).toBe(1);
    const task = await createTask(project.id);
    expect(task.ref).toBe("TEST-1");
  });

  it("rejects missing, malformed and tampered authentication while retaining public liveness", async () => {
    await api().get(`${base}/health/live`).expect(200);
    await api().get(`${base}/projects`).expect(401);
    await api().get(`${base}/projects`).auth("not-a-jwt", { type: "bearer" }).expect(401);
    const [header, payload, signature] = token.split(".");
    await api()
      .get(`${base}/projects`)
      .auth(`${header}.${payload}.${signature?.slice(0, -8)}AAAAAAAA`, { type: "bearer" })
      .expect(401);
    const invalidSubject = await harness.token({ organizationId, userId: "not-a-uuid" });
    await api().get(`${base}/projects`).auth(invalidSubject, { type: "bearer" }).expect(401);
    for (const options of [
      { issuer: "https://untrusted-issuer.test" },
      { audience: "other-service" },
      { expiresAt: Math.floor(Date.now() / 1000) - 60 },
    ]) {
      await api()
        .get(`${base}/projects`)
        .auth(await harness.token({ organizationId }, options), { type: "bearer" })
        .expect(401);
    }
  });

  it("returns redacted client errors for malformed JSON and oversized request bodies", async () => {
    const malformed = await api()
      .post(`${base}/projects`)
      .auth(token, { type: "bearer" })
      .set("Content-Type", "application/json")
      .send('{"secret":"private-malformed-payload",')
      .expect(400);
    expect(JSON.stringify(malformed.body)).not.toContain("private-malformed-payload");
    const oversized = await api()
      .post(`${base}/projects`)
      .auth(token, { type: "bearer" })
      .send({ key: "TOOBIG", name: "Oversized", description: "private-oversized-payload".repeat(20_000) })
      .expect(413);
    expect(JSON.stringify(oversized.body)).not.toContain("private-oversized-payload");
    expect(await prisma.project.count({ where: { organizationId } })).toBe(0);
  });

  it("supports versioned CRUD deletes and refuses removal of referenced resources", async () => {
    const project = await createProject();
    const epic = (
      await api()
        .post(`${base}/projects/${project.id}/epics`)
        .auth(token, { type: "bearer" })
        .send({ title: "Original epic" })
        .expect(201)
    ).body;
    await api()
      .patch(`${base}/epics/${epic.id}`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, title: "Updated epic" })
      .expect(200);
    const task = await createTask(project.id, { epicId: epic.id });
    await api().delete(`${base}/epics/${epic.id}?version=2`).auth(token, { type: "bearer" }).expect(409);
    const comment = (
      await api()
        .post(`${base}/tasks/${task.id}/comments`)
        .auth(token, { type: "bearer" })
        .send({ body: "Will delete" })
        .expect(201)
    ).body;
    await api().delete(`${base}/tasks/${task.id}?version=1`).auth(token, { type: "bearer" }).expect(409);
    await api()
      .delete(`${base}/comments/${comment.id}?version=1`)
      .auth(token, { type: "bearer" })
      .expect(200);
    await api().delete(`${base}/tasks/${task.id}`).auth(token, { type: "bearer" }).expect(400);
    await api().delete(`${base}/tasks/${task.id}?version=2`).auth(token, { type: "bearer" }).expect(409);
    await api().delete(`${base}/tasks/${task.id}?version=1`).auth(token, { type: "bearer" }).expect(200);
    await api().delete(`${base}/epics/${epic.id}?version=2`).auth(token, { type: "bearer" }).expect(200);
    const sprint = (
      await api()
        .post(`${base}/projects/${project.id}/sprints`)
        .auth(token, { type: "bearer" })
        .send({ name: "Original sprint", startDate, endDate })
        .expect(201)
    ).body;
    await api()
      .patch(`${base}/sprints/${sprint.id}`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, name: "Updated sprint" })
      .expect(200);
    await api().delete(`${base}/sprints/${sprint.id}?version=2`).auth(token, { type: "bearer" }).expect(200);
    const milestone = (
      await api()
        .post(`${base}/projects/${project.id}/milestones`)
        .auth(token, { type: "bearer" })
        .send({ name: "Will delete", date: endDate })
        .expect(201)
    ).body;
    await api()
      .delete(`${base}/milestones/${milestone.id}?version=1`)
      .auth(token, { type: "bearer" })
      .expect(200);
    for (const path of [
      `tasks/${task.id}`,
      `epics/${epic.id}`,
      `sprints/${sprint.id}`,
      `milestones/${milestone.id}`,
    ])
      await api().get(`${base}/${path}`).auth(token, { type: "bearer" }).expect(404);
    const deletionEvents = await prisma.outboxEvent.findMany({
      where: { projectId: project.id, eventType: { endsWith: ".deleted" } },
    });
    expect(deletionEvents.map((event) => event.eventType).sort()).toEqual([
      "comment.deleted",
      "epic.deleted",
      "milestone.deleted",
      "sprint.deleted",
      "task.deleted",
    ]);
    expect(deletionEvents.every((event) => (event.payload as { after: unknown }).after === null)).toBe(true);
  });

  it("limits same-organization project visibility and team-lead task changes to authorized teams", async () => {
    const teamId = uuid();
    const otherTeamId = uuid();
    const manager = await harness.token({ organizationId, userId, assignableTeamIds: [teamId, otherTeamId] });
    const project = (
      await api()
        .post(`${base}/projects`)
        .auth(manager, { type: "bearer" })
        .send({ key: "TEAM", name: "Teams", teamIds: [teamId, otherTeamId] })
        .expect(201)
    ).body;
    const ownTask = (
      await api()
        .post(`${base}/projects/${project.id}/tasks`)
        .auth(manager, { type: "bearer" })
        .send({ title: "Team task", teamId })
        .expect(201)
    ).body;
    const otherTask = (
      await api()
        .post(`${base}/projects/${project.id}/tasks`)
        .auth(manager, { type: "bearer" })
        .send({ title: "Other team task", teamId: otherTeamId })
        .expect(201)
    ).body;
    const outsider = await harness.token({ organizationId, role: "VIEWER" });
    expect(
      (await api().get(`${base}/projects?search=Teams`).auth(outsider, { type: "bearer" }).expect(200)).body
        .total,
    ).toBe(0);
    await api().get(`${base}/projects/${project.id}`).auth(outsider, { type: "bearer" }).expect(404);
    const lead = await harness.token({
      organizationId,
      role: "TEAM_LEAD",
      teamIds: [teamId],
      assignableTeamIds: [teamId, otherTeamId],
    });
    await api()
      .patch(`${base}/tasks/${ownTask.id}`)
      .auth(lead, { type: "bearer" })
      .send({ version: 1, title: "Allowed lead edit" })
      .expect(200);
    await api()
      .patch(`${base}/tasks/${otherTask.id}`)
      .auth(lead, { type: "bearer" })
      .send({ version: 1, title: "Outside team" })
      .expect(403);
    await api()
      .post(`${base}/projects/${project.id}/tasks`)
      .auth(lead, { type: "bearer" })
      .send({ title: "Outside team", teamId: otherTeamId })
      .expect(403);
  });

  it("rejects dependency cycles involving implicit parent-to-subtask completion requirements", async () => {
    const project = await createProject();
    const parent = await createTask(project.id);
    await api()
      .post(`${base}/projects/${project.id}/tasks`)
      .auth(token, { type: "bearer" })
      .send({ title: "Impossible child", type: "subtask", parentId: parent.id, blockedByIds: [parent.id] })
      .expect(409);
    const child = await createTask(project.id, { type: "subtask", parentId: parent.id });
    await api()
      .patch(`${base}/tasks/${child.id}`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, blockedByIds: [parent.id] })
      .expect(409);
    const intermediate = await createTask(project.id, { blockedByIds: [parent.id] });
    await api()
      .patch(`${base}/tasks/${child.id}`)
      .auth(token, { type: "bearer" })
      .send({ version: 1, blockedByIds: [intermediate.id] })
      .expect(409);
    expect(await prisma.task.count({ where: { projectId: project.id } })).toBe(3);
    expect(
      await prisma.outboxEvent.count({ where: { aggregateId: child.id, eventType: "task.updated" } }),
    ).toBe(0);
  });
});
