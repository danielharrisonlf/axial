import { describe, expect, it } from "vitest";
import { createDemoData } from "./seed";
import { createWorkspaceStore, STORAGE_KEY } from "./workspace";

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
    expect(store.getSnapshot().db).toEqual(before);
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
    expect(store.getSnapshot().db).toEqual(before);
    expect(store.getSnapshot().toasts.filter((toast) => toast.tone === "err")).toHaveLength(2);
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
});
