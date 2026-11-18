import { describe, expect, it } from "vitest";
import { daysLeft, projectRisk, todayLocal } from "../lib/format";
import demoSeed from "./demo-seed.json";
import { createWorkspaceStore, STORAGE_KEY } from "./demo-store";
import { createDemoData, SEED_VERSION } from "./seed";

const instant = new Date("2026-11-05T12:00:00.000Z");
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing acceptance fixture");
  return value;
}
function fixture() {
  const values = new Map<string, string>([["projectflow.db.v1", "preserved prototype state"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const store = createWorkspaceStore({ storage, initialData: createDemoData(instant), now: () => instant });
  return { store, storage, values };
}

describe("local workspace behavior", () => {
  it("returns created entities immediately and persists only its own demo key", () => {
    const { store, storage, values } = fixture();
    const project = store.act.createProject({ key: " qa ", name: " Acceptance workspace " });
    expect(project).toMatchObject({
      key: "QA",
      name: "Acceptance workspace",
      createdAt: instant.toISOString(),
    });
    expect(project).not.toBeNull();
    if (!project) throw new Error("Expected created project");
    const epic = store.act.createEpic(project.id, { name: "Acceptance epic" });
    const task = store.act.createTask({ projectId: project.id, title: "First task", epicId: epic?.id });
    expect(task).toMatchObject({ ref: "QA-101", projectId: project.id, epicId: epic?.id });
    const restored = createWorkspaceStore({ storage, now: () => instant });
    expect(restored.getSnapshot().db.tasks.find((item) => item.id === task?.id)).toEqual(task);
    expect(restored.getSnapshot().db.audit.some((entry) => entry.entityId === project.id)).toBe(true);
    expect(values.get("projectflow.db.v1")).toBe("preserved prototype state");
    expect([...values.keys()].sort()).toEqual([STORAGE_KEY, "projectflow.db.v1"].sort());
  });

  it("rejects writes from the viewer while preserving database contents", () => {
    const { store } = fixture();
    store.act.setUser("u18");
    const before = structuredClone(store.getSnapshot().db);
    expect(store.can("task.create")).toBe(false);
    expect(store.act.createProject({ key: "NO", name: "Not allowed" })).toBeNull();
    expect(store.act.createTask({ projectId: "prj-pcl", title: "Not allowed" })).toBeNull();
    store.act.moveTask(required(before.tasks[0]).id, "done");
    store.act.addComment(required(before.tasks[0]).id, "Not allowed");
    store.act.startSprint("sp-pcl-16");
    // nothing changes except the audit trail, which records each denied attempt
    const after = store.getSnapshot().db;
    expect({ ...after, audit: [] }).toEqual({ ...before, audit: [] });
    const denied = after.audit.slice(0, after.audit.length - before.audit.length);
    expect(denied.map((entry) => entry.summary)).toEqual([
      "tentativa sem permissão: gerenciar sprints",
      "tentativa sem permissão: comentar em tarefas",
      "tentativa sem permissão: criar tarefas",
      "tentativa sem permissão: criar projetos",
    ]);
    expect(denied.every((entry) => entry.action === "denied" && entry.userId === "u18")).toBe(true);
    expect(after.audit.slice(denied.length)).toEqual(before.audit);
    expect(store.getSnapshot().toasts.some((toast) => toast.tone === "err")).toBe(true);
  });

  it("limits a contributor to their organization and teams and rejects inaccessible writes", () => {
    const { store } = fixture();
    store.act.setUser("u16");
    expect(
      store
        .visibleProjects()
        .map((project) => project.id)
        .sort(),
    ).toEqual(["prj-cma", "prj-erp"]);
    const before = structuredClone(store.getSnapshot().db);
    store.act.setCurrentProject("prj-pcl");
    expect(store.act.createTask({ projectId: "prj-pcl", title: "Forbidden" })).toBeNull();
    expect(store.getSnapshot().db).toEqual(before);
  });

  it("applies organization scope to archived reads and restoration after profile switching", () => {
    const { store } = fixture();
    store.act.archiveProject("prj-cma");
    expect(store.visibleProjects(undefined, true).some((project) => project.id === "prj-cma")).toBe(true);
    store.act.setUser("u2");
    expect(store.visibleProjects(undefined, true).some((project) => project.id === "prj-cma")).toBe(false);
    const before = structuredClone(store.getSnapshot().db);
    store.act.restoreProject("prj-cma");
    expect(store.getSnapshot().db).toEqual(before);
    store.act.setUser("u1");
    store.act.restoreProject("prj-cma");
    expect(store.visibleProjects().some((project) => project.id === "prj-cma")).toBe(true);
  });

  it("rejects cross-project epic, sprint, parent and dependency references atomically", () => {
    const { store } = fixture();
    const db = store.getSnapshot().db;
    const foreignEpic = required(db.epics.find((epic) => epic.projectId !== "prj-pcl"));
    const foreignTask = required(db.tasks.find((task) => task.projectId !== "prj-pcl"));
    const before = structuredClone(db);
    for (const references of [
      { epicId: foreignEpic.id },
      { sprintId: "sp-pag-9" },
      { parentId: foreignTask.id },
      { blockedBy: [foreignTask.id] },
    ]) {
      expect(
        store.act.createTask({ projectId: "prj-pcl", title: "Invalid reference", ...references }),
      ).toBeNull();
      expect(store.getSnapshot().db).toEqual(before);
    }
  });

  it("rejects dependency cycles without altering either task", () => {
    const { store } = fixture();
    const first = required(store.act.createTask({ projectId: "prj-pcl", title: "First" }));
    const second = required(store.act.createTask({ projectId: "prj-pcl", title: "Second" }));
    store.act.updateTask(first.id, { blockedBy: [second.id] });
    const before = structuredClone(store.getSnapshot().db);
    store.act.updateTask(second.id, { blockedBy: [first.id] });
    expect(store.getSnapshot().db).toEqual(before);
    expect(store.getSnapshot().toasts.at(-1)?.message).toContain("ciclo");
  });

  it("rejects project teams and leads from another organization on create and update", () => {
    const { store } = fixture();
    const before = structuredClone(store.getSnapshot().db);
    for (const references of [{ teamIds: ["tm-consult"] }, { leadId: "u16" }]) {
      expect(store.act.createProject({ key: "BAD", name: "Invalid organization", ...references })).toBeNull();
      expect(store.getSnapshot().db).toEqual(before);
      store.act.updateProject("prj-pcl", references);
      expect(store.getSnapshot().db).toEqual(before);
    }
  });

  it("assigns the project's first valid team when creating a task without a team", () => {
    const { store } = fixture();
    const project = required(
      store.act.createProject({ key: "QAT", name: "Team defaults", teamIds: ["tm-web"] }),
    );
    const task = required(store.act.createTask({ projectId: project.id, title: "Inherit associated team" }));
    expect(task.teamId).toBe("tm-web");
    expect(store.getSnapshot().db.tasks.find((item) => item.id === task.id)?.teamId).toBe("tm-web");
  });

  it("preserves immutable before and after values in earlier audit entries", () => {
    const { store } = fixture();
    const task = required(store.act.createTask({ projectId: "prj-pcl", title: "Original title" }));
    store.act.updateTask(task.id, { title: "First revision" });
    const earlier = structuredClone(
      store.getSnapshot().db.audit.filter((entry) => entry.entityId === task.id),
    );
    store.act.updateTask(task.id, { title: "Second revision" });
    for (const entry of earlier) {
      expect(store.getSnapshot().db.audit.find((current) => current.id === entry.id)).toEqual(entry);
    }
    expect(earlier.find((entry) => entry.action === "create")?.after).toMatchObject({
      title: "Original title",
    });
    expect(earlier.find((entry) => entry.action === "update")?.before).toMatchObject({
      title: "Original title",
    });
    expect(earlier.find((entry) => entry.action === "update")?.after).toMatchObject({
      title: "First revision",
    });
  });

  it("keeps one active sprint and returns unfinished work to backlog on completion", () => {
    const { store } = fixture();
    const before = structuredClone(store.getSnapshot().db);
    store.act.startSprint("sp-pcl-16");
    expect(store.getSnapshot().db).toEqual(before);
    store.act.completeSprint("sp-pcl-15");
    expect(store.getSnapshot().db.sprints.find((sprint) => sprint.id === "sp-pcl-15")?.status).toBe("done");
    for (const original of before.tasks.filter((task) => task.sprintId === "sp-pcl-15")) {
      const task = required(store.getSnapshot().db.tasks.find((item) => item.id === original.id));
      expect(task).toMatchObject(
        original.status === "done"
          ? { status: "done", sprintId: "sp-pcl-15" }
          : { status: "backlog", sprintId: null },
      );
    }
    store.act.startSprint("sp-pcl-16");
    expect(store.getSnapshot().db.sprints.find((sprint) => sprint.id === "sp-pcl-16")?.status).toBe("active");
    expect(
      store.act.createTask({ projectId: "prj-pcl", title: "Closed sprint", sprintId: "sp-pcl-15" }),
    ).toBeNull();
  });

  it("records notification deliveries, honors event preferences and retries failed channels", () => {
    const { store } = fixture();
    const before = store.getSnapshot().db.notifications.length;
    required(
      store.act.createTask({ projectId: "prj-pcl", title: "Notificar responsável", assigneeId: "u8" }),
    );
    const first = store.getSnapshot().db.notifications.slice(0, 2);
    expect(store.getSnapshot().db.notifications).toHaveLength(before + 2);
    expect(first.map((item) => item.channel).sort()).toEqual(["email", "whatsapp"]);
    expect(first.every((item) => item.status === "delivered")).toBe(true);
    store.act.setNotifPref("task.assigned.v1", "whatsapp", false);
    store.act.setProvider("email", {
      from: "noreply@test.dev",
      host: "api.resend.com",
      configured: false,
    });
    required(store.act.createTask({ projectId: "prj-pcl", title: "Canal em falha", assigneeId: "u8" }));
    const failed = required(store.getSnapshot().db.notifications[0]);
    expect(failed).toMatchObject({ channel: "email", status: "failed", attempts: 1 });
    store.act.resendNotification(failed.id);
    expect(store.getSnapshot().db.notifications[0]).toMatchObject({ status: "failed", attempts: 2 });
    store.act.setProvider("email", {
      from: "noreply@test.dev",
      host: "api.resend.com",
      configured: true,
    });
    store.act.resendNotification(failed.id);
    expect(store.getSnapshot().db.notifications[0]).toMatchObject({ status: "delivered", attempts: 3 });
  });

  it("does not let a viewer change notification preferences or providers", () => {
    const { store } = fixture();
    store.act.setUser("u18");
    const before = structuredClone(store.getSnapshot().db);
    store.act.setNotifPref("task.assigned.v1", "email", false);
    store.act.setProvider("email", {
      from: "viewer@test.dev",
      host: "api.resend.com",
      configured: true,
    });
    const after = store.getSnapshot().db;
    expect({ ...after, audit: [] }).toEqual({ ...before, audit: [] });
    expect(after.audit.slice(0, 2).map((entry) => entry.action)).toEqual(["denied", "denied"]);
    expect(after.audit.slice(2)).toEqual(before.audit);
    // identical denials are grouped in one toast with a counter
    const denied = store.getSnapshot().toasts.filter((toast) => toast.tone === "err");
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ title: "Sem permissão", count: 2 });
  });

  it.each(["{invalid JSON", JSON.stringify({ settings: { currentUserId: "missing" } })])(
    "recovers incompatible saved data with a visible warning",
    (raw) => {
      const { storage, values } = fixture();
      storage.setItem(STORAGE_KEY, raw);
      const recovered = createWorkspaceStore({ storage, now: () => instant });
      expect(recovered.getSnapshot().db.projects).toHaveLength(11);
      expect(recovered.currentUser().id).toBe("u1");
      expect(recovered.getSnapshot().toasts).toEqual([expect.objectContaining({ tone: "warn" })]);
      recovered.act.setTheme("dark");
      expect(JSON.parse(required(values.get(STORAGE_KEY)))).toMatchObject({ settings: { theme: "dark" } });
    },
  );

  it("keeps mutations in the current session when storage is unavailable", () => {
    const store = createWorkspaceStore({
      initialData: createDemoData(instant),
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("Quota exceeded");
        },
        removeItem: () => undefined,
      },
    });
    store.act.setTheme("dark");
    store.act.setTheme("light");
    expect(store.getSnapshot().db.settings.theme).toBe("light");
    expect(store.getSnapshot().toasts.filter((toast) => toast.tone === "warn")).toHaveLength(1);
  });

  it("keeps at most three toasts visible, the oldest leaving first", () => {
    const { store } = fixture();
    for (const n of [1, 2, 3, 4]) store.notify(`Aviso ${n}`, "", "info");
    expect(store.getSnapshot().toasts.map((t) => t.title)).toEqual(["Aviso 2", "Aviso 3", "Aviso 4"]);
  });

  it("records the completion moment when a task enters and leaves done", () => {
    const { store } = fixture();
    const task = required(store.act.createTask({ projectId: "prj-pcl", title: "Concluir" }));
    expect(task.doneAt).toBeNull();
    store.act.moveTask(task.id, "done");
    expect(store.getSnapshot().db.tasks.find((t) => t.id === task.id)?.doneAt).toBe(instant.toISOString());
    store.act.moveTask(task.id, "in_progress");
    expect(store.getSnapshot().db.tasks.find((t) => t.id === task.id)?.doneAt).toBeNull();
  });

  it("keeps favorites per profile", () => {
    const { store } = fixture();
    const favorites = () => store.currentUser().favoriteProjectIds;
    expect(favorites()).toEqual(["prj-pcl", "prj-pag"]);
    store.act.toggleFavorite("prj-pcl");
    expect(favorites()).toEqual(["prj-pag"]);
    store.act.setUser("u2");
    expect(favorites()).toContain("prj-pcl");
  });

  it("records actions run as the MCP console with the mcp origin", () => {
    const { store } = fixture();
    store.act.runAs("mcp", () => store.act.createTask({ projectId: "prj-pcl", title: "Via MCP" }));
    store.act.createTask({ projectId: "prj-pcl", title: "Via interface" });
    const [ui, mcp] = store.getSnapshot().db.audit;
    expect(mcp).toMatchObject({ source: "mcp", summary: expect.stringContaining("criou a tarefa") });
    expect(ui).toMatchObject({ source: "ui" });
  });
});

describe("seed 9", () => {
  it("starts with a lean, varied notification history", () => {
    const db = createDemoData(instant);
    expect(db.meta.seedVersion).toBe(SEED_VERSION);
    expect(db.notifications).toHaveLength(8);
    expect(new Set(db.notifications.map((n) => n.eventType)).size).toBe(6);
    expect(new Set(db.notifications.map((n) => n.channel))).toEqual(new Set(["email", "whatsapp", "sms"]));
    const failed = db.notifications.filter((n) => n.status === "failed");
    expect(failed.map((n) => n.channel).sort()).toEqual(["email", "sms"]);
    expect(failed.every((n) => !!n.failReason)).toBe(true);
    expect(db.notifications.map((n) => n.ts)).toEqual(
      [...db.notifications.map((n) => n.ts)].sort().reverse(),
    );
    expect(db.notificationTemplates.find((t) => t.id === "nt-sprint-start")?.subject).toBe(
      "{sprint} iniciada",
    );
  });

  it("migrates a saved version 8 state, keeping the person's changes", () => {
    const { storage } = fixture();
    const legacy = structuredClone(demoSeed) as unknown as {
      meta: { seedVersion: number };
      projects: { id: string; favorite?: boolean; name: string }[];
      notifications: { id: string }[];
    };
    const renamed = required(legacy.projects[0]);
    renamed.name = "Nome alterado pela pessoa";
    const own = { ...required(legacy.notifications[0]), id: "nf-own-delivery" };
    legacy.notifications.unshift(own);
    storage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    const store = createWorkspaceStore({ storage, now: () => instant });
    const db = store.getSnapshot().db;
    expect(store.getSnapshot().toasts).toEqual([]);
    expect(db.meta.seedVersion).toBe(SEED_VERSION);
    expect(db.projects[0]?.name).toBe("Nome alterado pela pessoa");
    expect(db.projects.some((p) => "favorite" in p)).toBe(false);
    expect(store.currentUser().favoriteProjectIds).toEqual(["prj-pcl", "prj-pag"]);
    expect(db.notifications.filter((n) => n.id === "nf-own-delivery")).toHaveLength(1);
    expect(db.notifications.filter((n) => /^nf\d+$/.test(n.id))).toHaveLength(8);
    expect(db.tasks.filter((t) => t.status === "done").every((t) => t.doneAt === t.updatedAt)).toBe(true);
    expect(JSON.parse(required(storage.getItem(STORAGE_KEY))).meta.seedVersion).toBe(SEED_VERSION);
  });
});

describe("due dates on the local calendar", () => {
  it("counts yesterday as overdue and today as zero days left", () => {
    const now = new Date(2026, 10, 18, 23, 30);
    expect(daysLeft(todayLocal(0, now), now)).toBe(0);
    expect(daysLeft(todayLocal(-1, now), now)).toBe(-1);
    expect(daysLeft(todayLocal(1, now), now)).toBe(1);
    expect(todayLocal(0, now)).toBe("2026-11-18");
  });
});

describe("audit E2E findings (18/11)", () => {
  it("keeps every seeded instant in the past, newest action on top", () => {
    const db = createDemoData(instant);
    const future = db.audit.filter((entry) => Date.parse(entry.ts) > instant.getTime());
    expect(future).toEqual([]);
    expect(db.comments.every((c) => Date.parse(c.createdAt) <= instant.getTime())).toBe(true);
  });

  it("records only the changed fields with a specific action", () => {
    const { store } = fixture();
    store.act.updateTask("tsk9", { assigneeId: "u2" });
    const [entry] = store.getSnapshot().db.audit;
    expect(entry).toMatchObject({
      action: "assign",
      summary: "atribuiu PCL-109 a Ricardo Nogueira",
      before: { assigneeId: null },
      after: { assigneeId: "u2" },
    });
    store.act.moveTask("tsk9", "todo");
    expect(store.getSnapshot().db.audit[0]).toMatchObject({
      action: "status",
      before: { status: "backlog" },
      after: { status: "todo" },
    });
    expect(Object.keys(store.getSnapshot().db.audit[0]?.after as object)).toEqual(["status"]);
  });

  it("refuses and audits an assignment to someone else without task.assign", () => {
    const { store } = fixture();
    store.act.setUser("u8");
    expect(
      store.act.createTask({ projectId: "prj-pcl", title: "Para outra pessoa", assigneeId: "u2" }),
    ).toBeNull();
    expect(store.getSnapshot().db.audit[0]).toMatchObject({
      action: "denied",
      summary: "tentativa sem permissão: atribuir tarefas a outras pessoas",
    });
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({
      title: "Sem permissão",
      message: "O perfil “Desenvolvedor” não pode atribuir tarefas a outras pessoas.",
    });
    // taking the task yourself is allowed
    expect(
      store.act.createTask({ projectId: "prj-pcl", title: "Para mim", assigneeId: "u8" }),
    ).not.toBeNull();
  });

  it("does not count a finished blocker as risk", () => {
    const db = createDemoData(instant);
    const project = required(db.projects.find((p) => p.id === "prj-pcl"));
    const open = db.tasks.filter((t) => t.projectId === "prj-pcl" && !t.parentId && t.status !== "done");
    const blocker = required(open[0]);
    const done = { ...blocker, status: "done" as const };
    const withBlockers = {
      ...db,
      tasks: db.tasks.map((t) =>
        t.id === blocker.id
          ? done
          : open.slice(1, 3).some((x) => x.id === t.id)
            ? { ...t, blockedBy: [blocker.id] }
            : t,
      ),
    };
    expect(projectRisk(withBlockers, project).blocked).toBe(0);
  });

  it("lets a team lead edit an unassigned task of a visible project", () => {
    const { store } = fixture();
    store.act.setUser("u4");
    const task = required(store.getSnapshot().db.tasks.find((t) => t.id === "tsk9"));
    expect(task.assigneeId).toBeNull();
    expect(store.canTouchTask(task)).toBe(true);
  });

  it("adds an invited person to the chosen teams", () => {
    const { store } = fixture();
    const user = required(
      store.act.inviteUser({
        name: "Maria Lima",
        email: "maria@vetor.dev",
        title: "QA",
        roleId: "dev",
        teamIds: ["tm-web"],
      }),
    );
    expect(store.getSnapshot().db.teams.find((t) => t.id === "tm-web")?.memberIds).toContain(user.id);
  });
});
