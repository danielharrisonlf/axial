import "reflect-metadata";
import { fileURLToPath } from "node:url";
import {
  type AuthContext,
  createEpicSchema,
  createMilestoneSchema,
  createProjectSchema,
  createSprintSchema,
  createTaskSchema,
} from "@axial/contracts";
import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
if (process.env.NODE_ENV === "production") throw new Error("Demo seed cannot run in production");
const databaseName = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
if (!databaseName.endsWith("_dev")) throw new Error("Demo seed requires an explicitly named *_dev database");
process.env.RELAY_ENABLED = "false";
const { createApp } = await import("../src/app.js");
const { ProjectsService } = await import("../src/modules/projects.service.js");
const { PrismaService } = await import("../src/infra/database/prisma.service.js");
const app = await createApp();
const actor: AuthContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  role: "ADMIN",
  teamIds: ["22222222-2222-4222-8222-222222222222"],
  projectIds: [],
  assignableUserIds: ["11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333"],
  assignableTeamIds: ["22222222-2222-4222-8222-222222222222"],
  source: "api",
  correlationId: "development-demo-seed",
};

try {
  const service = app.get(ProjectsService);
  const db = app.get(PrismaService);
  const project =
    (await db.project.findUnique({
      where: { organizationId_key: { organizationId: actor.organizationId, key: "AXL" } },
    })) ??
    (await service.createProject(
      actor,
      createProjectSchema.parse({
        key: "AXL",
        name: "Axial - Demonstracao local",
        description: "Dados ficticios de desenvolvimento. Nao representam uma organizacao real.",
        leadId: actor.userId,
        teamIds: actor.teamIds,
      }),
    ));
  const epic =
    (await db.epic.findFirst({ where: { projectId: project.id, title: "Primeira entrega" } })) ??
    (await service.createEpic(actor, project.id, createEpicSchema.parse({ title: "Primeira entrega" })));
  const start = new Date();
  const end = new Date(start.getTime() + 14 * 86400000);
  const sprint =
    (await db.sprint.findFirst({ where: { projectId: project.id, name: "Sprint de demonstracao" } })) ??
    (await service.createSprint(
      actor,
      project.id,
      createSprintSchema.parse({
        name: "Sprint de demonstracao",
        goal: "Validar o fluxo de planejamento e execucao",
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      }),
    ));
  let task = await db.task.findFirst({
    where: { projectId: project.id, title: "Validar fluxo de projetos" },
  });
  task ??= await service.createTask(
    actor,
    project.id,
    createTaskSchema.parse({
      title: "Validar fluxo de projetos",
      epicId: epic.id,
      sprintId: sprint.id,
      assigneeId: actor.userId,
      teamId: actor.teamIds[0],
      status: "todo",
      priority: "high",
      acceptanceCriteria: ["Planejamento, Kanban e eventos funcionando"],
      startDate: start.toISOString(),
      dueDate: end.toISOString(),
    }),
  );
  if (!(await db.task.findFirst({ where: { projectId: project.id, title: "Conferir comentarios" } }))) {
    await service.createTask(
      actor,
      project.id,
      createTaskSchema.parse({
        title: "Conferir comentarios",
        type: "subtask",
        parentId: task.id,
        epicId: epic.id,
        sprintId: sprint.id,
        assigneeId: actor.userId,
        teamId: actor.teamIds[0],
      }),
    );
  }
  if (
    !(await db.milestone.findFirst({ where: { projectId: project.id, name: "Primeira entrega validada" } }))
  ) {
    await service.createMilestone(
      actor,
      project.id,
      createMilestoneSchema.parse({
        name: "Primeira entrega validada",
        date: end.toISOString(),
      }),
    );
  }
  console.log(
    `Development demo ready: ${project.key} (${project.id}). Re-running preserves existing records.`,
  );
} finally {
  await app.close();
}
