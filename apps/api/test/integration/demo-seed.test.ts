import { randomUUID } from "node:crypto";
import {
  ATLAS_ORGANIZATION_ID,
  buildDemoFixtures,
  claimsFor,
  demoUser,
  VETOR_ORGANIZATION_ID,
} from "@axial/demo-fixtures";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedProjects } from "../../prisma/demo-seed.js";
import { PrismaService } from "../../src/infra/database/prisma.service.js";
import { startTestApp } from "../support/app-harness.js";

const scenario = {
  projects: 11,
  epics: 14,
  sprints: 7,
  milestones: 10,
  tasks: 109,
  dependencies: 1,
  comments: 33,
};

describe("demo seed of ms-projects", () => {
  let harness: Awaited<ReturnType<typeof startTestApp>>;
  let prisma: PrismaService;
  const fixtures = buildDemoFixtures();
  const where = { organizationId: { in: [VETOR_ORGANIZATION_ID, ATLAS_ORGANIZATION_ID] } };
  const removeScenario = async () => {
    await prisma.comment.deleteMany({ where });
    await prisma.taskDependency.deleteMany({ where });
    await prisma.task.deleteMany({ where: { ...where, parentId: { not: null } } });
    await prisma.task.deleteMany({ where });
    await prisma.epic.deleteMany({ where });
    await prisma.sprint.deleteMany({ where });
    await prisma.milestone.deleteMany({ where });
    await prisma.project.deleteMany({ where });
    await prisma.outboxEvent.deleteMany({ where });
  };

  beforeAll(async () => {
    harness = await startTestApp();
    prisma = harness.app.get(PrismaService);
    await removeScenario();
  });
  afterAll(async () => {
    if (prisma) await removeScenario();
    await harness?.close();
  });

  it("inserts the scenario once and is a no-op when repeated", async () => {
    const first = await seedProjects(prisma, fixtures);
    expect(first).toEqual({ status: "seeded", inserted: scenario, present: scenario, warnings: [] });
    const second = await seedProjects(prisma, buildDemoFixtures({ now: new Date(Date.now() + 86_400_000) }));
    expect(second.inserted).toEqual({
      projects: 0,
      epics: 0,
      sprints: 0,
      milestones: 0,
      tasks: 0,
      dependencies: 0,
      comments: 0,
    });
    expect(second.present).toEqual(scenario);
    expect(second.status).toBe("already seeded");
    expect(second.warnings).toEqual([]);
    expect(await prisma.outboxEvent.count({ where })).toBe(0);
  });

  it("keeps refs, history and continues the task sequence through the API", async () => {
    const pcl = await prisma.project.findFirstOrThrow({
      where: { organizationId: VETOR_ORGANIZATION_ID, key: "PCL" },
    });
    expect(pcl).toMatchObject({ taskSequence: 119, color: "#2B5FD9" });
    const done = await prisma.task.findFirstOrThrow({
      where: { organizationId: VETOR_ORGANIZATION_ID, ref: "PCL-102" },
    });
    expect(done.completedAt?.toISOString()).toBe(
      fixtures.tasks.find((task) => task.ref === "PCL-102")?.updatedAt,
    );
    expect(
      await prisma.sprint.count({ where: { organizationId: VETOR_ORGANIZATION_ID, status: "active" } }),
    ).toBe(3);

    const ricardo = claimsFor(demoUser("ricardo.nogueira@vetorlabs.dev").id);
    const token = await harness.token(ricardo);
    const created = await request(harness.app.getHttpServer())
      .post(`/api/v1/projects/${pcl.id}/tasks`)
      .auth(token, { type: "bearer" })
      .send({ title: "Tarefa criada depois do seed" })
      .expect(201);
    expect(created.body.ref).toBe("PCL-120");

    const sergio = claimsFor(demoUser("sergio.tavares@vetorlabs.dev").id);
    const list = await request(harness.app.getHttpServer())
      .get("/api/v1/projects?pageSize=100")
      .auth(await harness.token(sergio), { type: "bearer" })
      .expect(200);
    expect(list.body.items.map((project: { key: string }) => project.key).sort()).toEqual([
      "APC",
      "DLK",
      "FAT",
      "NUV",
      "OBS",
      "ONB",
      "PAG",
      "PCL",
      "WEB",
    ]);
  });

  it("never restores seeded rows removed after the first run and reports them as warnings", async () => {
    const comment = fixtures.comments[0];
    const referenced = new Set([
      ...fixtures.comments.map((item) => item.taskId),
      ...fixtures.tasks.flatMap((task) => [task.parentId, ...task.blockedByIds]),
      ...fixtures.tasks.filter((task) => task.blockedByIds.length).map((task) => task.id),
    ]);
    const task = fixtures.tasks.find((item) => !referenced.has(item.id));
    if (!comment || !task) throw new Error("scenario without a removable comment and task");
    await prisma.comment.delete({ where: { id: comment.id } });
    await prisma.task.delete({ where: { id: task.id } });

    const again = await seedProjects(prisma, fixtures);
    expect(again.status).toBe("already seeded");
    expect(Object.values(again.inserted).every((value) => value === 0)).toBe(true);
    expect(again.present).toEqual({
      ...scenario,
      tasks: scenario.tasks - 1,
      comments: scenario.comments - 1,
    });
    const keyOf = (projectId: string) => fixtures.projects.find((project) => project.id === projectId)?.key;
    expect(again.warnings.join("\n")).toContain(`project ${keyOf(task.projectId)}: scenario rows present:`);
    expect(again.warnings.some((warning) => /tasks \d+ of \d+/.test(warning))).toBe(true);
    expect(again.warnings.some((warning) => /comments \d+ of \d+/.test(warning))).toBe(true);
    expect(await prisma.task.count({ where: { id: task.id } })).toBe(0);
    expect(await prisma.comment.count({ where: { id: comment.id } })).toBe(0);
  });

  it("completes a project missing after an interrupted run and skips a project whose key is taken", async () => {
    const project = fixtures.projects.find((item) => item.organizationId === ATLAS_ORGANIZATION_ID);
    if (!project) throw new Error("scenario without an Atlas project");
    const scope = { organizationId: project.organizationId, projectId: project.id };
    const removeProject = async () => {
      await prisma.comment.deleteMany({ where: scope });
      await prisma.taskDependency.deleteMany({ where: scope });
      await prisma.task.deleteMany({ where: { ...scope, parentId: { not: null } } });
      await prisma.task.deleteMany({ where: scope });
      await prisma.epic.deleteMany({ where: scope });
      await prisma.sprint.deleteMany({ where: scope });
      await prisma.milestone.deleteMany({ where: scope });
      await prisma.project.deleteMany({ where: { id: project.id } });
    };
    const owned = (items: { projectId: string }[]) =>
      items.filter((item) => item.projectId === project.id).length;
    const own = {
      projects: 1,
      epics: owned(fixtures.epics),
      sprints: owned(fixtures.sprints),
      milestones: owned(fixtures.milestones),
      tasks: owned(fixtures.tasks),
      dependencies: fixtures.tasks
        .filter((task) => task.projectId === project.id)
        .reduce((total, task) => total + task.blockedByIds.length, 0),
      comments: owned(fixtures.comments),
    };
    await removeProject();
    const completed = await seedProjects(prisma, fixtures);
    expect(completed.status).toBe("seeded");
    expect(completed.inserted).toEqual(own);
    // rows removed in the previous test stay removed
    expect(completed.present).toEqual({
      ...scenario,
      tasks: scenario.tasks - 1,
      comments: scenario.comments - 1,
    });

    await removeProject();
    const other = randomUUID();
    await prisma.project.create({
      data: {
        id: other,
        organizationId: project.organizationId,
        key: project.key,
        name: "Outro projeto com a mesma chave",
        leadId: project.leadId,
        createdBy: project.createdBy,
      },
    });
    const skipped = await seedProjects(prisma, fixtures);
    expect(skipped.status).toBe("already seeded");
    expect(Object.values(skipped.inserted).every((value) => value === 0)).toBe(true);
    expect(skipped.warnings).toContain(
      `project ${project.key} (${project.id}) skipped: its key already belongs to project ${other}`,
    );
    expect(await prisma.project.count({ where: { id: project.id } })).toBe(0);
  });
});
