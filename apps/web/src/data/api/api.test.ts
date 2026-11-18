import { describe, expect, it, vi } from "vitest";
import { type AccessClaims, createAuthSession, decodeClaims, ORGANIZATION_KEY } from "./auth";
import { createHttpClient, fetchAllPages, type TokenSource } from "./http";
import { loadWorkspace } from "./loader";
import {
  type ApiAuditEvent,
  type ApiTask,
  fromLocalDay,
  mapAuditEvent,
  mapEpic,
  mapMember,
  mapMilestone,
  mapProject,
  mapTask,
  toLocalDay,
} from "./mappers";
import { CONFLICT_TOAST, createApiStore } from "./store";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const TEAM = "44444444-4444-4444-8444-444444444444";
const TASK = "55555555-5555-4555-8555-555555555555";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(claims: Partial<AccessClaims> = {}) {
  return `${b64({ alg: "RS256" })}.${b64({
    sub: USER,
    organizationId: ORG,
    role: "PROJECT_MANAGER",
    teamIds: [TEAM],
    projectIds: [PROJECT],
    assignableUserIds: [USER],
    assignableTeamIds: [TEAM],
    exp: 9_999_999_999,
    ...claims,
  })}.signature`;
}
const json = (status: number, body: unknown) =>
  new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  return { fetch, calls };
}
const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

const apiTask = (overrides: Partial<ApiTask> = {}): ApiTask => ({
  id: TASK,
  projectId: PROJECT,
  ref: "PCL-120",
  title: "Revisar contrato",
  description: "Detalhes",
  type: "task",
  status: "todo",
  priority: "high",
  assigneeId: USER,
  teamId: TEAM,
  epicId: null,
  sprintId: null,
  parentId: null,
  labels: ["backend"],
  acceptanceCriteria: [{ text: "Aprovado", done: true }],
  dueDate: "2026-11-20T02:59:59.999Z",
  completedAt: null,
  createdBy: USER,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
  version: 3,
  dependencies: [{ dependsOnId: "66666666-6666-4666-8666-666666666666" }],
  ...overrides,
});
const apiProject = {
  id: PROJECT,
  organizationId: ORG,
  key: "PCL",
  name: "Portal do Cliente",
  description: "Portal",
  color: null,
  status: "active" as const,
  priority: "high" as const,
  leadId: USER,
  teamIds: [TEAM],
  startDate: "2026-10-01T03:00:00.000Z",
  endDate: null,
  archivedAt: null,
  version: 2,
  createdAt: "2026-10-01T12:00:00.000Z",
};

describe("mappers", () => {
  it("maps tasks to the prototype model with local calendar days", () => {
    const task = mapTask(apiTask());
    expect(task).toMatchObject({
      id: TASK,
      ref: "PCL-120",
      desc: "Detalhes",
      acceptance: [{ text: "Aprovado", done: true }],
      blockedBy: ["66666666-6666-4666-8666-666666666666"],
      doneAt: null,
      dueDate: toLocalDay("2026-11-20T02:59:59.999Z"),
    });
    expect(mapTask(apiTask({ status: "done", completedAt: "2026-11-03T00:00:00.000Z" })).doneAt).toBe(
      "2026-11-03T00:00:00.000Z",
    );
  });
  it("maps projects, epics and milestones", () => {
    const project = mapProject(apiProject);
    expect(project).toMatchObject({ orgId: ORG, desc: "Portal", targetDate: null, archived: false });
    expect(project.color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(mapProject({ ...apiProject, archivedAt: "2026-11-01T00:00:00Z", leadId: null })).toMatchObject({
      archived: true,
      leadId: "",
    });
    expect(
      mapEpic({
        id: "e",
        projectId: PROJECT,
        title: "Checkout",
        description: "",
        status: "in_progress",
        ownerId: null,
        version: 1,
      }),
    ).toMatchObject({ name: "Checkout", status: "active", ownerId: "" });
    expect(
      mapMilestone({
        id: "m",
        projectId: PROJECT,
        name: "Go-live",
        date: "2026-12-01T02:59:59.999Z",
        completedAt: "2026-11-30T00:00:00Z",
        version: 1,
      }).status,
    ).toBe("done");
  });
  it("maps members with roles, initials and favorites", () => {
    const user = mapMember(
      {
        id: USER,
        name: "Ricardo Nogueira",
        email: "r@x.dev",
        title: null,
        role: "TEAM_LEAD",
        active: true,
        teamIds: [TEAM],
      },
      ORG,
      [PROJECT],
    );
    expect(user).toMatchObject({ roleId: "lead", initials: "RN", title: "", favoriteProjectIds: [PROJECT] });
  });
  it("round-trips local days through ISO instants at both edges", () => {
    expect(toLocalDay(fromLocalDay("2026-11-20", "start"))).toBe("2026-11-20");
    expect(toLocalDay(fromLocalDay("2026-11-20", "end"))).toBe("2026-11-20");
    expect(() => toLocalDay("not a date")).toThrow();
  });
  it("translates audit events into the prototype vocabulary", () => {
    const event: ApiAuditEvent = {
      id: "a1",
      projectId: PROJECT,
      eventType: "task.status_changed",
      aggregateType: "task",
      aggregateId: TASK,
      actorId: USER,
      actorSource: "mcp",
      occurredAt: "2026-11-02T10:00:00Z",
      data: {
        before: { ref: "PCL-120", status: "todo", version: 1 },
        after: { ref: "PCL-120", status: "done", version: 2 },
      },
    };
    expect(mapAuditEvent(event, { user: () => "Ricardo" })).toMatchObject({
      action: "status",
      entityType: "task",
      entityId: TASK,
      source: "mcp",
      summary: "moveu PCL-120 de A fazer para Concluído",
      before: { status: "todo" },
      after: { status: "done" },
    });
  });
});

describe("http client", () => {
  it("refreshes once on 401 and retries with the new token", async () => {
    let current = "old";
    const tokens: TokenSource = {
      token: () => current,
      refresh: vi.fn(async () => {
        current = "new";
        return current;
      }),
      expired: vi.fn(),
    };
    const { fetch, calls } = fakeFetch((_url, init) =>
      header(init, "authorization") === "Bearer new" ? json(200, { ok: true }) : json(401, {}),
    );
    const http = createHttpClient({ baseUrl: "https://api.test", fetch, tokens });
    await expect(http.request("/projects")).resolves.toEqual({ ok: true });
    expect(calls.map((c) => header(c.init, "authorization"))).toEqual(["Bearer old", "Bearer new"]);
    expect(calls[0]?.url).toBe("https://api.test/api/v1/projects");
    expect(tokens.refresh).toHaveBeenCalledTimes(1);
    expect(tokens.expired).not.toHaveBeenCalled();
  });
  it("ends the session when the retry is also refused, and never loops", async () => {
    const tokens: TokenSource = { token: () => "t", refresh: async () => "t2", expired: vi.fn() };
    const { fetch, calls } = fakeFetch(() => json(401, { message: "Unauthorized" }));
    const http = createHttpClient({ baseUrl: "", fetch, tokens });
    await expect(http.request("/me")).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(2);
    expect(tokens.expired).toHaveBeenCalledTimes(1);
  });
  it("reports a network failure as status 0", async () => {
    const http = createHttpClient({
      baseUrl: "",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(http.request("/me", { auth: false })).rejects.toMatchObject({ status: 0 });
  });
});

describe("loader paging", () => {
  it("reads every page and refuses silent truncation", async () => {
    const pages: number[] = [];
    const all = await fetchAllPages(async (page, pageSize) => {
      pages.push(page);
      const start = (page - 1) * pageSize;
      return {
        items: Array.from({ length: Math.min(pageSize, 250 - start) }, (_, i) => start + i),
        total: 250,
      };
    }, 100);
    expect(all).toHaveLength(250);
    expect(all.at(-1)).toBe(249);
    expect(pages.sort()).toEqual([1, 2, 3]);
    await expect(fetchAllPages(async () => ({ items: [1], total: 10_000 }), 100, 5)).rejects.toThrow(
      /grande demais/,
    );
  });
  it("loads the organization from the services only", async () => {
    const { fetch, calls } = fakeFetch((url) => {
      const path = new URL(url).pathname;
      const page = Number(new URL(url).searchParams.get("page") ?? 1);
      if (path === "/api/v1/me")
        return json(200, {
          userId: USER,
          organizationId: ORG,
          role: "PROJECT_MANAGER",
          name: "Ricardo",
          email: "r@x.dev",
          title: null,
          memberships: [{ organizationId: ORG, organizationName: "Vetor Labs", role: "PROJECT_MANAGER" }],
        });
      if (path === "/api/v1/organization/members" || path === "/api/v1/organization/teams")
        return json(200, []);
      if (path === "/api/v1/projects")
        return json(200, {
          items: new URL(url).searchParams.get("archived") === "true" ? [] : [apiProject],
          total: 1,
        });
      if (path === "/api/v1/tasks")
        return json(200, {
          items: page === 1 ? [apiTask()] : [apiTask({ id: "77777777-7777-4777-8777-777777777777" })],
          total: 101,
        });
      return json(200, { items: [], total: 0 });
    });
    const http = createHttpClient({ baseUrl: "https://api.test", fetch });
    const payload = await loadWorkspace(http, { audit: false });
    expect(payload.projects).toHaveLength(1);
    expect(payload.tasks).toHaveLength(2);
    expect(calls.some((c) => c.url.includes("/audit"))).toBe(false);
    expect(calls.filter((c) => c.url.includes("/api/v1/tasks?"))).toHaveLength(2);
  });
});

describe("auth session", () => {
  function storage() {
    const values = new Map<string, string>();
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
  }
  it("shares one refresh between concurrent callers (single flight)", async () => {
    let resolve: (response: Response) => void = () => undefined;
    const { fetch, calls } = fakeFetch(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const auth = createAuthSession({
      http: createHttpClient({ baseUrl: "", fetch }),
      storage: storage(),
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    const first = auth.refresh();
    const second = auth.refresh();
    expect(first).toBe(second);
    resolve(json(200, { accessToken: token(), expiresIn: 300 }));
    await expect(first).resolves.toBe(token());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.credentials).toBe("include");
    expect(auth.getState()).toMatchObject({ kind: "signedIn", organizationId: ORG });
  });
  it("schedules the refresh 60 s before expiry and keeps the token only in memory", async () => {
    const delays: number[] = [];
    const store = storage();
    const { fetch } = fakeFetch(() => json(200, { accessToken: token(), expiresIn: 300 }));
    const auth = createAuthSession({
      http: createHttpClient({ baseUrl: "", fetch }),
      storage: store,
      setTimer: (_cb, ms) => delays.push(ms),
      clearTimer: () => undefined,
    });
    await auth.login("r@x.dev", "secret-password");
    expect(delays).toEqual([240_000]);
    expect(auth.token()).toBe(token());
    expect([...store.values.entries()]).toEqual([[ORGANIZATION_KEY, ORG]]);
  });
  it("asks for the organization, then exchanges the cookie session with X-Organization-Id", async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.endsWith("/auth/login")
        ? json(200, {
            requiresOrganization: true,
            organizations: [{ id: ORG, name: "Vetor Labs", role: "ADMIN" }],
            sessionToken: "opaque",
          })
        : json(200, { accessToken: token(), expiresIn: 300 }),
    );
    const auth = createAuthSession({
      http: createHttpClient({ baseUrl: "", fetch }),
      storage: storage(),
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    await auth.login("helena@x.dev", "secret-password");
    expect(auth.getState()).toMatchObject({ kind: "chooseOrganization" });
    await auth.chooseOrganization(ORG);
    expect(header(calls[1]?.init ?? {}, "x-organization-id")).toBe(ORG);
    expect(auth.getState().kind).toBe("signedIn");
  });
  it("returns to the login when the cookie session is gone", async () => {
    const { fetch } = fakeFetch(() => json(401, { message: "Unauthorized" }));
    const auth = createAuthSession({ http: createHttpClient({ baseUrl: "", fetch }), storage: storage() });
    await auth.restore();
    expect(auth.getState()).toEqual({ kind: "signedOut", notice: null });
    await expect(auth.refresh()).resolves.toBeNull();
  });
  it("decodes the claims the interface uses", () => {
    expect(decodeClaims(token({ role: "VIEWER" }))).toMatchObject({ role: "VIEWER", organizationId: ORG });
  });
});

describe("api store writes", () => {
  function storeWith(handler: (url: string, init: RequestInit) => Response) {
    const { fetch, calls } = fakeFetch((url, init) => {
      const path = new URL(url).pathname;
      if (init.method && init.method !== "GET") return handler(url, init);
      if (path === "/api/v1/me")
        return json(200, {
          userId: USER,
          organizationId: ORG,
          role: "PROJECT_MANAGER",
          name: "Ricardo",
          email: "r@x.dev",
          title: null,
          memberships: [],
        });
      if (path.startsWith("/api/v1/organization/")) return json(200, []);
      if (path === `/api/v1/projects/${PROJECT}`) return json(200, apiProject);
      if (path === "/api/v1/projects")
        return json(200, {
          items: new URL(url).searchParams.get("archived") === "true" ? [] : [apiProject],
          total: 1,
        });
      if (path === "/api/v1/tasks") return json(200, { items: [apiTask({ version: 9 })], total: 1 });
      return json(200, { items: [], total: 0 });
    });
    const claims = decodeClaims(token());
    const store = createApiStore({
      http: createHttpClient({ baseUrl: "https://api.test", fetch }),
      claims: () => claims,
    });
    return { store, calls };
  }
  it("moves a task optimistically with its version and keeps the confirmed row", async () => {
    const { store, calls } = storeWith((_url, init) =>
      json(200, apiTask({ ...JSON.parse(String(init.body)), version: 10 })),
    );
    await store.load();
    const pending = store.act.moveTask(TASK, "in_review");
    expect(store.getSnapshot().db.tasks[0]?.status).toBe("in_review");
    await pending;
    const write = calls.find((c) => c.init.method === "PATCH");
    expect(write?.url).toBe(`https://api.test/api/v1/tasks/${TASK}/status`);
    expect(JSON.parse(String(write?.init.body))).toEqual({ version: 9, status: "in_review" });
    expect(store.versionOf(TASK)).toBe(10);
  });
  it("rolls back on 409, says someone changed the item and reloads the project", async () => {
    const { store, calls } = storeWith(() => json(409, { message: "Version conflict; reload the resource" }));
    await store.load();
    await store.act.moveTask(TASK, "done");
    expect(store.getSnapshot().db.tasks[0]?.status).toBe("todo");
    expect(store.getSnapshot().toasts.map((t) => t.title)).toContain(CONFLICT_TOAST);
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith(`/projects/${PROJECT}`))).toBe(true));
  });
  it("rolls back on 403 with a permission message", async () => {
    const { store } = storeWith(() => json(403, { message: "Forbidden" }));
    await store.load();
    await store.act.updateTask(TASK, { title: "Outro título" });
    expect(store.getSnapshot().db.tasks[0]?.title).toBe("Revisar contrato");
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ title: "Sem permissão", tone: "err" });
  });
  it("marks data stale after a failed reload and disables writes", async () => {
    // a loaded store keeps its data and becomes read only
    const flaky = { ok: true };
    const { fetch } = fakeFetch((url) => {
      if (!flaky.ok) throw new TypeError("offline");
      return storeFetch(url);
    });
    function storeFetch(url: string) {
      const path = new URL(url, "https://api.test").pathname;
      if (path === "/api/v1/me")
        return json(200, {
          userId: USER,
          organizationId: ORG,
          role: "PROJECT_MANAGER",
          name: "R",
          email: "r@x.dev",
          title: null,
          memberships: [],
        });
      if (path.startsWith("/api/v1/organization/")) return json(200, []);
      if (path === "/api/v1/tasks") return json(200, { items: [apiTask()], total: 1 });
      return json(200, { items: [], total: 0 });
    }
    const live = createApiStore({
      http: createHttpClient({ baseUrl: "https://api.test", fetch }),
      claims: () => decodeClaims(token()),
    });
    await live.load();
    flaky.ok = false;
    await live.load();
    expect(live.getSnapshot().sync).toMatchObject({ stale: true });
    expect(live.getSnapshot().db.tasks).toHaveLength(1);
    expect(live.can("task.create")).toBe(false);
    expect(live.can("task.view")).toBe(true);
  });
});
