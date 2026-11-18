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
    expect(first).toEqual({ inserted: scenario, present: scenario });
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
});
