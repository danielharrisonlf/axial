import { InsufficientScopeError, ProtocolError, SdkHttpError } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type Harness,
  json,
  OTHER_PROJECT,
  PROJECT,
  page,
  projectFixture,
  promptText,
  sprintFixture,
  startHarness,
  taskFixture,
  text,
  USER,
} from "./support/harness.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});
beforeEach(() => {
  h.stub.reset();
});

const READ_TOOLS = [
  "list-projects",
  "get-project",
  "project-summary",
  "get-board",
  "list-backlog",
  "get-timeline",
  "list-epics",
  "get-epic",
  "list-milestones",
  "get-milestone",
  "list-tasks",
  "get-task",
  "list-comments",
  "list-sprints",
  "get-sprint",
  "search-audit",
  "audit-summary",
  "list-notifications",
  "get-notification-preferences",
  "list-members",
  "list-teams",
];
const DESTRUCTIVE_TOOLS = [
  "archive-project",
  "delete-epic",
  "delete-milestone",
  "delete-task",
  "delete-comment",
  "complete-sprint",
  "delete-sprint",
];
const WRITE_TOOLS = [
  "create-project",
  "update-project",
  "restore-project",
  "create-epic",
  "update-epic",
  "create-milestone",
  "update-milestone",
  "create-task",
  "update-task",
  "update-task-status",
  "assign-task",
  "update-task-dependencies",
  "add-comment",
  "update-comment",
  "create-sprint",
  "update-sprint",
  "start-sprint",
  "assign-tasks-to-sprint",
  "set-notification-event-preference",
  "retry-notification",
  "create-team",
  "update-team",
  "set-team-member",
  "set-project-access",
];

describe("catalog", () => {
  it("lists every tool with descriptions, described arguments and coherent annotations", async () => {
    const client = await h.connect(await h.token({ role: "ADMIN" }));
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.description?.length, tool.name).toBeGreaterThan(20);
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [name, property] of Object.entries(properties))
        expect(property.description, `${tool.name}.${name}`).toBeTruthy();
      const hints = tool.annotations ?? {};
      if (READ_TOOLS.includes(tool.name)) expect(hints.readOnlyHint, tool.name).toBe(true);
      else expect(hints.readOnlyHint, tool.name).toBe(false);
      expect(hints.destructiveHint === true, tool.name).toBe(DESTRUCTIVE_TOOLS.includes(tool.name));
      if (DESTRUCTIVE_TOOLS.includes(tool.name)) expect(properties.confirm, tool.name).toBeDefined();
    }
    for (const name of [
      "list-projects",
      "get-project",
      "project-summary",
      "list-tasks",
      "get-task",
      "list-sprints",
      "get-sprint",
      "search-audit",
    ])
      expect(tools.find((tool) => tool.name === name)?.outputSchema, name).toBeDefined();
  });

  it("lists resources, resource templates and prompts with described arguments", async () => {
    const client = await h.connect(await h.token());
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual(["axial://me", "axial://projects"]);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate).sort()).toEqual([
      "axial://projects/{projectId}",
      "axial://projects/{projectId}/board",
      "axial://sprints/{sprintId}",
      "axial://tasks/{taskId}",
    ]);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      "planejar-sprint",
      "refinar-tarefa",
      "relatorio-de-risco",
      "resumo-semanal",
    ]);
    for (const prompt of prompts)
      for (const argument of prompt.arguments ?? []) expect(argument.description, prompt.name).toBeTruthy();
  });

  it("sends server instructions written for the model", async () => {
    const client = await h.connect(await h.token());
    expect(client.getInstructions()).toMatch(/optimistic concurrency/);
    expect(client.getInstructions()).toMatch(/axial:\/\/me/);
  });
});

describe("authentication", () => {
  it("refuses a connection without a token", async () => {
    await expect(h.connect(undefined)).rejects.toBeInstanceOf(SdkHttpError);
  });

  it("refuses tokens signed by another key, for another audience or expired", async () => {
    await expect(h.connect(await h.foreignToken())).rejects.toBeInstanceOf(SdkHttpError);
    await expect(h.connect(await h.token({ audience: "other" }))).rejects.toBeInstanceOf(SdkHttpError);
    await expect(
      h.connect(await h.token({ expiresIn: Math.floor(Date.now() / 1000) - 60 })),
    ).rejects.toBeInstanceOf(SdkHttpError);
  });

  it("refuses tokens with malformed identity claims", async () => {
    await expect(h.connect(await h.token({ claims: { organizationId: "acme" } }))).rejects.toBeInstanceOf(
      SdkHttpError,
    );
  });
});

describe("scopes", () => {
  it("a viewer gets insufficient_scope for writes before the method runs", async () => {
    const viewer = await h.connect(await h.token({ role: "VIEWER" }));
    const error = await viewer
      .callTool({ name: "create-task", arguments: { projectId: PROJECT, title: "x" } })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InsufficientScopeError);
    expect((error as InsufficientScopeError).requiredScope).toBe("projects:write");
    expect(h.stub.seen).toHaveLength(0);
  });

  it("a scope claim narrows the role: projects:read only cannot write or read audit", async () => {
    const narrowed = await h.connect(await h.token({ role: "ADMIN", scope: "projects:read" }));
    await expect(
      narrowed.callTool({
        name: "update-task-status",
        arguments: { taskId: PROJECT, status: "done", version: 1 },
      }),
    ).rejects.toBeInstanceOf(InsufficientScopeError);
    await expect(narrowed.callTool({ name: "search-audit", arguments: {} })).rejects.toBeInstanceOf(
      InsufficientScopeError,
    );
    h.stub.on("GET", "projects", "/projects", { body: page([projectFixture()]) });
    expect((await narrowed.callTool({ name: "list-projects", arguments: {} })).isError).toBeFalsy();
  });

  it("contributors cannot read the audit trail nor administer identity", async () => {
    const contributor = await h.connect(await h.token({ role: "CONTRIBUTOR" }));
    await expect(contributor.callTool({ name: "search-audit", arguments: {} })).rejects.toBeInstanceOf(
      InsufficientScopeError,
    );
    await expect(contributor.callTool({ name: "list-members", arguments: {} })).rejects.toBeInstanceOf(
      InsufficientScopeError,
    );
  });

  it("resources and prompts check scopes too; axial://me needs none", async () => {
    const notificationsOnly = await h.connect(await h.token({ scope: "notifications:read" }));
    await expect(notificationsOnly.readResource({ uri: "axial://projects" })).rejects.toBeInstanceOf(
      InsufficientScopeError,
    );
    await expect(
      notificationsOnly.getPrompt({ name: "relatorio-de-risco", arguments: { projectId: PROJECT } }),
    ).rejects.toBeInstanceOf(InsufficientScopeError);
    const me = await notificationsOnly.readResource({ uri: "axial://me" });
    const identity = JSON.parse((me.contents[0] as { text: string }).text) as Record<string, unknown>;
    expect(identity).toMatchObject({ userId: USER, role: "PROJECT_MANAGER", scopes: ["notifications:read"] });
  });
});

describe("caller identity and organization scope", () => {
  it("forwards the caller's own token and filters to ms-projects", async () => {
    const token = await h.token();
    h.stub.on("GET", "projects", `/projects/${PROJECT}/tasks`, { body: page([taskFixture(1)]) });
    const client = await h.connect(token);
    const result = await client.callTool({
      name: "list-tasks",
      arguments: { projectId: PROJECT, status: "todo", priority: "high" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ total: 1, items: [{ ref: "CHK-1" }] });
    const [request] = h.stub.requests("GET", "projects");
    expect(request?.authorization).toBe(`Bearer ${token}`);
    expect(request?.query.get("status")).toBe("todo");
    expect(request?.query.get("priority")).toBe("high");
  });

  it("a project outside the caller's organization comes back as a clear not-found tool error", async () => {
    const client = await h.connect(await h.token());
    const result = await client.callTool({ name: "get-project", arguments: { projectId: OTHER_PROJECT } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Not found \[404\]: .*outside the caller's organization or projects/);
    expect(result._meta).toMatchObject({ "axial/status": 404 });
  });

  it("an upstream permission denial is reported without retry advice to other ids", async () => {
    h.stub.on("POST", "projects", `/projects/${PROJECT}/tasks`, {
      status: 403,
      body: { statusCode: 403, message: "Read only role", correlationId: "req-42" },
    });
    const client = await h.connect(await h.token({ role: "CONTRIBUTOR" }));
    const result = await client.callTool({
      name: "create-task",
      arguments: { projectId: PROJECT, title: "New" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Forbidden \[403\]: Read only role\. Do not retry/);
    expect(text(result)).toContain("correlation id req-42");
  });

  it("upstream failures never leak internal details", async () => {
    h.stub.on("GET", "projects", "/projects", {
      status: 500,
      body: { message: 'relation "projects.task" does not exist at Prisma...' },
    });
    const client = await h.connect(await h.token());
    const result = await client.callTool({ name: "list-projects", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Upstream unavailable [502]: Projects API unavailable; try again later");
  });

  it("validation issues from the service are passed on so the model can fix the call", async () => {
    h.stub.on("POST", "projects", `/projects/${PROJECT}/sprints`, {
      status: 400,
      body: { message: "Sprint start date must be before its end date" },
    });
    const client = await h.connect(await h.token());
    const result = await client.callTool({
      name: "create-sprint",
      arguments: {
        projectId: PROJECT,
        name: "S2",
        startDate: "2026-12-10T00:00:00Z",
        endDate: "2026-12-01T00:00:00Z",
      },
    });
    expect(text(result)).toBe("Invalid request [400]: Sprint start date must be before its end date");
  });

  it("invalid arguments are rejected by the input schema before any upstream call", async () => {
    const client = await h.connect(await h.token());
    const result = await client.callTool({ name: "get-task", arguments: { taskId: "CHK-1" } });
    expect(result.isError).toBe(true);
    expect(h.stub.seen).toHaveLength(0);
  });
});

describe("optimistic concurrency", () => {
  it("sends the version and turns a 409 into actionable guidance", async () => {
    const task = taskFixture(1);
    h.stub.on("PATCH", "projects", `/tasks/${task.id}/status`, {
      status: 409,
      body: { statusCode: 409, message: "Version conflict; reload the resource", correlationId: "c-1" },
    });
    const client = await h.connect(await h.token());
    const result = await client.callTool({
      name: "update-task-status",
      arguments: { taskId: task.id, status: "done", version: 1 },
    });
    expect(h.stub.requests("PATCH", "projects")[0]?.body).toEqual({ status: "done", version: 1 });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /^Conflict \[409\]: Version conflict; reload the resource\. Read the resource again to get its current version/,
    );
  });

  it("update-task-dependencies merges blockers and keeps the caller's version", async () => {
    const task = taskFixture(1, { dependencies: [{ dependsOnId: taskFixture(2).id }] });
    h.stub
      .on("GET", "projects", `/tasks/${task.id}`, { body: task })
      .on("PATCH", "projects", `/tasks/${task.id}`, (request) => ({
        body: { ...task, ...(request.body as object) },
      }));
    const client = await h.connect(await h.token());
    await client.callTool({
      name: "update-task-dependencies",
      arguments: { taskId: task.id, version: 2, add: [taskFixture(3).id], remove: [taskFixture(2).id] },
    });
    expect(h.stub.requests("PATCH", "projects")[0]?.body).toEqual({
      version: 2,
      blockedByIds: [taskFixture(3).id],
    });
  });
});

describe("destructive confirmation", () => {
  const task = taskFixture(7);
  const routes = () =>
    h.stub
      .on("GET", "projects", `/tasks/${task.id}`, { body: task })
      .on("DELETE", "projects", `/tasks/${task.id}`, { body: { id: task.id, deleted: true } });

  it("legacy era: requires confirm: true and changes nothing without it", async () => {
    routes();
    const client = await h.connect(await h.token(), "legacy");
    const refused = await client.callTool({
      name: "delete-task",
      arguments: { taskId: task.id, version: 2 },
    });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/Confirmation required: Delete task CHK-7 .*call again with confirm: true/);
    expect(h.stub.requests("DELETE", "projects")).toHaveLength(0);
    const done = await client.callTool({
      name: "delete-task",
      arguments: { taskId: task.id, version: 2, confirm: true },
    });
    expect(json(done)).toEqual({ id: task.id, deleted: true });
    expect(h.stub.requests("DELETE", "projects")[0]?.query.get("version")).toBe("2");
  });

  it("modern era without the elicitation capability falls back to confirm: true", async () => {
    routes();
    const client = await h.connect(await h.token(), "modern");
    const refused = await client.callTool({
      name: "delete-task",
      arguments: { taskId: task.id, version: 2 },
    });
    expect(text(refused)).toMatch(/Confirmation required/);
    expect(h.stub.requests("DELETE", "projects")).toHaveLength(0);
  });

  it("modern era with elicitation: the user is asked and accepting deletes", async () => {
    routes();
    const asked: string[] = [];
    const client = await h.connectEliciting(
      await h.token(),
      { action: "accept", content: { confirm: true } },
      asked,
    );
    const result = await client.callTool({ name: "delete-task", arguments: { taskId: task.id, version: 2 } });
    expect(asked).toEqual(['Delete task CHK-7 — "Task 7" permanently?']);
    expect(json(result)).toEqual({ id: task.id, deleted: true });
    expect(h.stub.requests("DELETE", "projects")).toHaveLength(1);
  });

  it("modern era with elicitation: declining changes nothing", async () => {
    routes();
    const client = await h.connectEliciting(await h.token(), { action: "decline" });
    const result = await client.callTool({ name: "delete-task", arguments: { taskId: task.id, version: 2 } });
    expect(text(result)).toBe("Cancelled by the user; nothing was changed.");
    expect(h.stub.requests("DELETE", "projects")).toHaveLength(0);
  });

  it("complete-sprint tells the user how many tasks go back to the backlog", async () => {
    const sprint = sprintFixture();
    h.stub
      .on("GET", "projects", `/sprints/${sprint.id}`, { body: sprint })
      .on("GET", "projects", `/projects/${PROJECT}/tasks`, (request) => ({
        body: page([], request.query.get("status") === "done" ? 3 : 5),
      }))
      .on("POST", "projects", `/sprints/${sprint.id}/complete`, { body: { ...sprint, status: "done" } });
    const asked: string[] = [];
    const client = await h.connectEliciting(
      await h.token(),
      { action: "accept", content: { confirm: true } },
      asked,
    );
    await client.callTool({ name: "complete-sprint", arguments: { sprintId: sprint.id, version: 3 } });
    expect(asked[0]).toBe(
      'Complete sprint "Sprint 1"? 2 of its 5 tasks are unfinished and will return to the backlog.',
    );
    expect(h.stub.requests("POST", "projects")[0]?.body).toEqual({ version: 3 });
  });
});

describe("batch progress", () => {
  it("assign-tasks-to-sprint reports progress and the outcome of each task", async () => {
    const sprint = sprintFixture({ status: "planned" });
    const [a, b] = [taskFixture(1), taskFixture(2)];
    h.stub
      .on("GET", "projects", `/tasks/${a.id}`, { body: a })
      .on("GET", "projects", `/tasks/${b.id}`, { body: b })
      .on("PATCH", "projects", `/tasks/${a.id}`, { body: { ...a, sprintId: sprint.id, version: 3 } })
      .on("PATCH", "projects", `/tasks/${b.id}`, {
        status: 409,
        body: { message: "Tasks of completed sprints are immutable" },
      });
    const client = await h.connect(await h.token());
    const progress: string[] = [];
    const result = await client.callTool(
      { name: "assign-tasks-to-sprint", arguments: { sprintId: sprint.id, taskIds: [a.id, b.id] } },
      { onprogress: (update) => void progress.push(`${update.progress}/${update.total}`) },
    );
    expect(progress).toEqual(["1/2", "2/2"]);
    expect(json(result)).toMatchObject({
      processed: 2,
      succeeded: 1,
      failed: 1,
      results: [
        { ref: "CHK-1", ok: true, version: 3 },
        {
          ref: "CHK-2",
          ok: false,
          error: expect.stringMatching(/^Conflict \[409\]: Tasks of completed sprints/),
        },
      ],
    });
    expect(h.stub.requests("PATCH", "projects")[0]?.body).toEqual({ version: 2, sprintId: sprint.id });
  });
});

describe("resources", () => {
  it("renders the Kanban board as Markdown with blocked and overdue flags", async () => {
    const blocker = taskFixture(1, { status: "in_progress" });
    const blocked = taskFixture(2, {
      status: "todo",
      priority: "urgent",
      dueDate: "2020-01-01T00:00:00.000Z",
      dependencies: [{ dependsOnId: blocker.id }],
    });
    h.stub
      .on("GET", "projects", `/projects/${PROJECT}`, { body: projectFixture() })
      .on("GET", "projects", `/projects/${PROJECT}/board`, {
        body: {
          projectId: PROJECT,
          columns: ["backlog", "todo", "in_progress", "in_review", "done"].map((status) => ({
            status,
            ...page([blocker, blocked].filter((task) => task.status === status)),
          })),
        },
      });
    const client = await h.connect(await h.token());
    const { contents } = await client.readResource({ uri: `axial://projects/${PROJECT}/board` });
    const markdown = (contents[0] as { text: string; mimeType: string }).text;
    expect(contents[0]?.mimeType).toBe("text/markdown");
    expect(markdown).toContain("# Quadro CHK — Checkout");
    expect(markdown).toContain("## Em andamento (1)");
    expect(markdown).toMatch(/CHK-2 · Task 2 · A fazer · urgent .*ATRASADA.*bloqueada por CHK-1/);
  });

  it("reads a task with subtasks and comments, and rejects a non-UUID id", async () => {
    const task = taskFixture(4);
    h.stub
      .on("GET", "projects", `/tasks/${task.id}`, { body: task })
      .on("GET", "projects", `/projects/${PROJECT}/tasks`, { body: page([]) })
      .on("GET", "projects", `/tasks/${task.id}/comments`, { body: page([{ body: "Looks good" }]) });
    const client = await h.connect(await h.token());
    const { contents } = await client.readResource({ uri: `axial://tasks/${task.id}` });
    expect(JSON.parse((contents[0] as { text: string }).text)).toMatchObject({
      task: { ref: "CHK-4" },
      comments: { items: [{ body: "Looks good" }] },
    });
    await expect(client.readResource({ uri: "axial://tasks/CHK-4" })).rejects.toBeInstanceOf(ProtocolError);
  });

  it("a task outside the caller's scope is a resource-not-found error", async () => {
    const client = await h.connect(await h.token());
    const error = await client
      .readResource({ uri: `axial://tasks/${OTHER_PROJECT}` })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).message).toMatch(/Not found \[404\]/);
  });

  it("reads a sprint with its tasks and progress", async () => {
    const sprint = sprintFixture();
    h.stub
      .on("GET", "projects", `/sprints/${sprint.id}`, { body: sprint })
      .on("GET", "projects", `/projects/${PROJECT}/tasks`, {
        body: page([taskFixture(1, { status: "done", sprintId: sprint.id }), taskFixture(2)]),
      });
    const client = await h.connect(await h.token());
    const { contents } = await client.readResource({ uri: `axial://sprints/${sprint.id}` });
    expect(JSON.parse((contents[0] as { text: string }).text)).toMatchObject({
      progress: { total: 2, done: 1, truncated: false },
    });
    expect(h.stub.requests("GET", "projects", `/projects/${PROJECT}/tasks`)[0]?.query.get("sprintId")).toBe(
      sprint.id,
    );
  });
});

describe("prompts", () => {
  const projectRoutes = () =>
    h.stub
      .on("GET", "projects", `/projects/${PROJECT}`, { body: projectFixture() })
      .on("GET", "projects", `/projects/${PROJECT}/summary`, {
        body: {
          projectId: PROJECT,
          total: 3,
          done: 1,
          byStatus: { done: 1, todo: 2 },
          overdue: 1,
          completionPercent: 33.33,
          estimatedPoints: 9,
          completedPoints: 3,
        },
      })
      .on("GET", "projects", `/projects/${PROJECT}/sprints`, { body: page([sprintFixture()]) })
      .on("GET", "projects", `/projects/${PROJECT}/milestones`, { body: page([]) })
      .on("GET", "projects", `/projects/${PROJECT}/backlog`, {
        body: page([taskFixture(2, { priority: "low" }), taskFixture(3, { priority: "urgent" })]),
      })
      .on("GET", "projects", `/projects/${PROJECT}/tasks`, {
        body: page([
          taskFixture(1, { status: "done", completedAt: new Date().toISOString() }),
          taskFixture(2, { priority: "low" }),
          taskFixture(3, { priority: "urgent", dueDate: "2020-01-01T00:00:00.000Z" }),
        ]),
      });

  it("planejar-sprint embeds the real backlog ordered by priority", async () => {
    projectRoutes();
    const client = await h.connect(await h.token());
    const result = await client.getPrompt({
      name: "planejar-sprint",
      arguments: { projectId: PROJECT, capacidade: "20" },
    });
    const body = promptText(result);
    expect(body).toContain("Capacidade da equipe: 20 pontos.");
    expect(body.indexOf("CHK-3")).toBeLessThan(body.indexOf("CHK-2"));
    expect(body).toContain("Sprint 1 [active]");
  });

  it("relatorio-de-risco lists overdue tasks from live data", async () => {
    projectRoutes();
    const client = await h.connect(await h.token());
    const result = await client.getPrompt({ name: "relatorio-de-risco", arguments: { projectId: PROJECT } });
    expect(promptText(result)).toMatch(/Atrasadas \(1\):\n- CHK-3/);
  });

  it("refinar-tarefa embeds the task, blockers and comments", async () => {
    const blocker = taskFixture(9, { status: "in_review" });
    const task = taskFixture(5, { description: "Pay with PIX", dependencies: [{ dependsOnId: blocker.id }] });
    h.stub
      .on("GET", "projects", `/tasks/${task.id}`, { body: task })
      .on("GET", "projects", `/tasks/${blocker.id}`, { body: blocker })
      .on("GET", "projects", `/projects/${PROJECT}/tasks`, { body: page([]) })
      .on("GET", "projects", `/tasks/${task.id}/comments`, {
        body: page([{ authorId: USER, body: "Needs QR code", createdAt: "2026-11-16T10:00:00Z" }]),
      });
    const client = await h.connect(await h.token());
    const result = await client.getPrompt({ name: "refinar-tarefa", arguments: { taskId: task.id } });
    const body = promptText(result);
    expect(body).toContain("Pay with PIX");
    expect(body).toContain("CHK-9 · Task 9 · Em revisão");
    expect(body).toContain("Needs QR code");
    expect(body).toContain(`version ${task.version}`);
  });

  it("resumo-semanal includes audit activity only when the token has audit:read", async () => {
    projectRoutes();
    h.stub.on("GET", "audit", "/audit/summary", {
      body: { total: 12, byEventType: [{ eventType: "task.completed", count: 4 }], byActor: [], byDay: [] },
    });
    const manager = await h.connect(await h.token({ role: "PROJECT_MANAGER" }));
    const withAudit = await manager.getPrompt({ name: "resumo-semanal", arguments: { projectId: PROJECT } });
    expect(promptText(withAudit)).toContain("Auditoria do período: 12 eventos.");
    expect(h.stub.requests("GET", "audit")[0]?.query.get("projectId")).toBe(PROJECT);

    h.stub.seen.length = 0;
    const contributor = await h.connect(await h.token({ role: "CONTRIBUTOR" }));
    const withoutAudit = await contributor.getPrompt({
      name: "resumo-semanal",
      arguments: { projectId: PROJECT },
    });
    const body = promptText(withoutAudit);
    expect(body).toContain("Auditoria não incluída: o token não tem o scope audit:read.");
    expect(body).toMatch(/Concluídas no período \(1\):\n- CHK-1/);
    expect(h.stub.requests("GET", "audit")).toHaveLength(0);
  });
});

describe("other services", () => {
  it("search-audit forwards filters to ms-audit and validates the output", async () => {
    h.stub.on("GET", "audit", "/audit", {
      body: page([
        {
          id: "0190f0f0-0000-7000-8000-000000000901",
          organizationId: PROJECT,
          projectId: PROJECT,
          eventType: "task.completed",
          aggregateType: "task",
          aggregateId: taskFixture(1).id,
          aggregateVersion: 3,
          actorId: USER,
          actorSource: "mcp",
          correlationId: "abc",
          occurredAt: "2026-11-17T10:00:00.000Z",
          receivedAt: "2026-11-17T10:00:01.000Z",
          data: {},
        },
      ]),
    });
    const client = await h.connect(await h.token());
    const result = await client.callTool({
      name: "search-audit",
      arguments: { projectId: PROJECT, eventType: "task.completed" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ total: 1 });
    expect(h.stub.requests("GET", "audit")[0]?.query.get("eventType")).toBe("task.completed");
  });

  it("notification and identity tools call their own services with the caller's token", async () => {
    const token = await h.token({ role: "ADMIN" });
    h.stub
      .on("PATCH", "notifications", "/notification-event-preferences/task.assigned.v1/email", {
        body: { event: "task.assigned.v1", channel: "email", enabled: false },
      })
      .on("POST", "identity", `/members/${USER}/projects/${PROJECT}`, { body: { enabled: true } });
    const client = await h.connect(token);
    await client.callTool({
      name: "set-notification-event-preference",
      arguments: { event: "task.assigned.v1", channel: "email", enabled: false },
    });
    await client.callTool({
      name: "set-project-access",
      arguments: { userId: USER, projectId: PROJECT, enabled: true },
    });
    expect(h.stub.requests("PATCH", "notifications")[0]).toMatchObject({
      authorization: `Bearer ${token}`,
      body: { enabled: false },
    });
    expect(h.stub.requests("POST", "identity")[0]?.body).toEqual({ enabled: true });
  });
});
