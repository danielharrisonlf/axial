import {
  canArchiveProject,
  canAssign,
  canChangeProjectMembership,
  canComment,
  canCreateProject,
  canEditTaskFields,
  canManageProject,
  editableTaskFields,
  type PolicyActor,
} from "@axial/contracts";
import { plural } from "../../lib/format";
import type {
  AuditEntry,
  Milestone,
  NotificationProvider,
  Project,
  RoleId,
  Task,
  Theme,
  Toast,
  ToastTone,
  User,
  WorkspaceData,
} from "../types";
import {
  API_CAPS,
  type SyncState,
  type WorkspaceActions,
  type WorkspaceSnapshot,
  type WorkspaceStore,
} from "../workspace";
import type { AccessClaims } from "./auth";
import { type Commands, createCommands } from "./commands";
import { ApiError, type HttpClient, isUnavailable } from "./http";
import { loadAudit, loadComments, loadProject, loadWorkspace, type WorkspacePayload } from "./loader";
import {
  API_ROLES,
  type ApiTask,
  fromLocalDay,
  fromLocalDayOrNull,
  mapAuditEvent,
  mapComment,
  mapEpic,
  mapMember,
  mapMilestone,
  mapOrganizations,
  mapProject,
  mapSprint,
  mapTask,
  mapTeam,
  toApiRole,
  toRoleId,
} from "./mappers";

/**
 * Workspace store backed by the services. Same snapshot and actions as the demo store, so the
 * pages stay the same; the differences are:
 * - reads hydrate an in-memory copy of the organization (no local persistence of business data);
 * - writes are optimistic, carry the resource version and roll back on refusal (409 reloads the
 *   project and says so; 403 explains the permission); writes on one resource run in sequence;
 * - a failed read keeps the last data, marks it stale (banner) and disables writes until a reload;
 * - favorites, theme and the selected project are local preferences per person and organization.
 */

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface ApiStoreOptions {
  http: HttpClient;
  /** Claims of the current access token (they change on each refresh). */
  claims: () => AccessClaims;
  storage?: StoragePort;
  now?: () => Date;
}

export const CONFLICT_TOAST = "Alguém alterou este item; os dados foram recarregados";
export const THEME_KEY = "kairos.theme";

const WRITE_CAPS = new Set([
  "project.create",
  "project.edit",
  "project.archive",
  "project.members",
  "task.create",
  "task.edit",
  "task.move",
  "task.assign",
  "task.delete",
  "comment.create",
  "sprint.manage",
  "team.manage",
  "user.manage",
  "notif.manage",
]);

/** Messages of the services in the words of the interface. */
const MESSAGES: Record<string, string> = {
  "Complete all subtasks first": "Conclua todas as subtarefas antes.",
  "Complete all blocking tasks first": "Conclua as tarefas que bloqueiam esta antes.",
  "Reopen the parent before reopening this subtask": "Reabra a tarefa principal antes desta subtarefa.",
  "Reopen completed dependent tasks first": "Reabra antes as tarefas concluídas que dependem desta.",
  "Task has subtasks, comments or dependents":
    "A tarefa tem subtarefas, comentários ou dependências; ela não pode ser excluída.",
  "Project already has an active sprint": "Já existe uma sprint ativa neste projeto.",
  "Only planned sprints can start": "Somente sprints planejadas podem iniciar.",
  "Only active sprints can complete": "Somente sprints ativas podem encerrar.",
  "Cannot assign tasks to a completed sprint": "A sprint já foi encerrada.",
  "Tasks in completed sprints are immutable": "Tarefas de sprints encerradas não podem mudar.",
  "Dependency cycle is not allowed": "Essa dependência criaria um ciclo.",
  "A subtask cannot depend on its parent": "Uma subtarefa não pode depender da tarefa principal.",
  "Project teams are still assigned to tasks": "Há tarefas nas equipes removidas do projeto.",
  "Project is archived": "Projetos arquivados são somente leitura.",
  "Resource already exists": "Já existe um registro com estes dados (por exemplo, a chave do projeto).",
  "User is not assignable in this organization": "Essa pessoa não pode receber tarefas suas.",
  "Team is not assignable in this organization": "Equipe fora do seu alcance.",
  "Start date must be on or before end date": "A data final deve ser posterior à data inicial.",
  "Sprint start date must be before its end date": "Defina um período válido.",
  "Organization must retain an active administrator": "A empresa precisa manter um administrador ativo.",
  "Cannot revoke your own administrator access": "Não é possível retirar o próprio acesso de administrador.",
  "Validation failed": "Revise os dados informados.",
};
const translate = (message: string) => MESSAGES[message] ?? message;

const UNCONFIGURED: NotificationProvider = { name: "", configured: false, from: "", host: "" };

const byCreated = (a: { createdAt: string }, b: { createdAt: string }) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let toastSeq = 0;

export function createApiStore(options: ApiStoreOptions) {
  const { http, storage } = options;
  const now = options.now ?? (() => new Date());
  const commands: Commands = createCommands(http);
  const versions = new Map<string, number>();
  const listeners = new Set<() => void>();
  let loaded = false;
  let lastMe: WorkspacePayload["me"] | null = null;

  const claims = options.claims;
  const organizationId = () => claims().organizationId;
  const actor = (): PolicyActor => {
    const c = claims();
    return {
      userId: c.sub,
      role: c.role,
      teamIds: c.teamIds,
      projectIds: c.projectIds,
      assignableUserIds: c.assignableUserIds,
      assignableTeamIds: c.assignableTeamIds,
    };
  };
  const roleId = (): RoleId => toRoleId(claims().role);

  /* ------------------------- local preferences ------------------------- */
  const read = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null; // blocked storage: preferences fall back to their defaults
    }
  };
  const write = (key: string, value: string) => {
    try {
      storage?.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };
  const favoritesKey = () => `kairos.favorites.${organizationId()}.${claims().sub}`;
  const projectKey = () => `kairos.project.${organizationId()}.${claims().sub}`;
  const readFavorites = (): string[] => {
    const raw = read(favoritesKey());
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  };
  const storedTheme = (): Theme => {
    const value = read(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  };

  const emptyDb = (): WorkspaceData => ({
    meta: { seedVersion: 0, seededAt: now().toISOString() },
    settings: {
      theme: storedTheme(),
      activeApp: "workspace",
      currentUserId: claims().sub,
      currentProjectId: read(projectKey()) ?? "",
      navCollapsed: false,
    },
    orgs: [],
    roles: API_ROLES,
    users: [],
    teams: [],
    projects: [],
    epics: [],
    sprints: [],
    milestones: [],
    tasks: [],
    comments: [],
    audit: [],
    notifications: [],
    notificationTemplates: [],
    notificationPreferences: {},
    notificationProviders: { email: UNCONFIGURED, whatsapp: UNCONFIGURED, sms: UNCONFIGURED },
    taskCounters: {},
  });
  const freshSync = (): SyncState => ({ stale: false, message: null, refreshing: false });
  let snapshot: WorkspaceSnapshot & { sync: SyncState } = { db: emptyDb(), toasts: [], sync: freshSync() };
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const setDb = (update: (db: WorkspaceData) => WorkspaceData) => {
    snapshot = { ...snapshot, db: update(snapshot.db) };
    emit();
  };
  const setSync = (sync: Partial<SyncState>) => {
    snapshot = { ...snapshot, sync: { ...snapshot.sync, ...sync } };
    emit();
  };

  /* ------------------------------ toasts ------------------------------ */
  const MAX_TOASTS = 3;
  const notify = (title: string, message = "", tone: ToastTone = "info") => {
    const same = snapshot.toasts.find((t) => t.title === title && t.message === message && t.tone === tone);
    const toasts: Toast[] = same
      ? snapshot.toasts.map((t) => (t === same ? { ...t, count: t.count + 1 } : t))
      : [...snapshot.toasts, { id: `toast-${++toastSeq}`, title, message, tone, count: 1 }].slice(
          -MAX_TOASTS,
        );
    snapshot = { ...snapshot, toasts };
    emit();
  };
  const dismissToast = (id: string) => {
    snapshot = { ...snapshot, toasts: snapshot.toasts.filter((t) => t.id !== id) };
    emit();
  };

  /* --------------------------- hydration ------------------------------ */
  const track = (rows: { id: string; version: number }[]) => {
    for (const row of rows) versions.set(row.id, row.version);
  };
  const userNames = (users: User[]) => ({ user: (id: string) => users.find((u) => u.id === id)?.name });
  const usersFrom = (payload: WorkspacePayload): User[] => {
    const favorites = readFavorites();
    const org = organizationId();
    const users = payload.members.map((member) =>
      mapMember(member, org, member.id === claims().sub ? favorites : []),
    );
    // the directory lists every member; the signed-in person is always present for the shell
    if (!users.some((user) => user.id === payload.me.userId))
      users.push(
        mapMember(
          {
            id: payload.me.userId,
            name: payload.me.name,
            email: payload.me.email,
            title: payload.me.title,
            role: payload.me.role,
            active: true,
            teamIds: claims().teamIds,
          },
          org,
          favorites,
        ),
      );
    return users;
  };
  const apply = (payload: WorkspacePayload) => {
    versions.clear();
    track(payload.projects);
    track(payload.epics);
    track(payload.sprints);
    track(payload.milestones);
    track(payload.tasks);
    lastMe = payload.me;
    const users = usersFrom(payload);
    const tasks = payload.tasks.map(mapTask).sort(byCreated);
    const taskIds = new Set(tasks.map((task) => task.id));
    setDb((db) => ({
      ...db,
      settings: { ...db.settings, currentUserId: payload.me.userId },
      orgs: mapOrganizations(payload.me),
      users,
      teams: payload.teams.map((team) => mapTeam(team, organizationId())),
      projects: payload.projects.map(mapProject).sort(byCreated),
      epics: payload.epics.map(mapEpic),
      sprints: payload.sprints.map(mapSprint),
      milestones: payload.milestones.map(mapMilestone),
      tasks,
      comments: db.comments.filter((comment) => taskIds.has(comment.taskId)),
      audit: (payload.audit ?? []).map((event) => mapAuditEvent(event, userNames(users))),
    }));
  };
  const markStale = (error: unknown) => {
    const message =
      error instanceof ApiError && error.status !== 0
        ? `O serviço respondeu com erro (${error.status}).`
        : "Não foi possível falar com o servidor.";
    setSync({ stale: true, message, refreshing: false });
  };
  /** Full read of the organization. Throws on the first load; afterwards a failure marks the data stale. */
  const load = async () => {
    setSync({ refreshing: true });
    try {
      const payload = await loadWorkspace(http, {
        audit: ["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD"].includes(claims().role),
      });
      apply(payload);
      loaded = true;
      setSync(freshSync());
    } catch (error) {
      if (!loaded) {
        setSync({ refreshing: false });
        throw error;
      }
      if (error instanceof ApiError && error.status === 401) {
        setSync({ refreshing: false });
        return; // the session handler shows the login
      }
      markStale(error);
    }
  };

  const replaceProject = (payload: Awaited<ReturnType<typeof loadProject>>) => {
    const { project } = payload;
    track([project, ...payload.epics, ...payload.sprints, ...payload.milestones, ...payload.tasks]);
    const tasks = payload.tasks.map(mapTask);
    setDb((db) => {
      const others = <T extends { projectId: string }>(rows: T[]) =>
        rows.filter((row) => row.projectId !== project.id);
      const mapped = mapProject(project);
      const exists = db.projects.some((p) => p.id === project.id);
      return {
        ...db,
        projects: exists
          ? db.projects.map((p) => (p.id === project.id ? mapped : p))
          : [...db.projects, mapped],
        epics: [...others(db.epics), ...payload.epics.map(mapEpic)],
        sprints: [...others(db.sprints), ...payload.sprints.map(mapSprint)],
        milestones: [...others(db.milestones), ...payload.milestones.map(mapMilestone)],
        tasks: [...others(db.tasks), ...tasks].sort(byCreated),
      };
    });
  };
  const forgetProject = (projectId: string) =>
    setDb((db) => {
      const removed = new Set(db.tasks.filter((t) => t.projectId === projectId).map((t) => t.id));
      return {
        ...db,
        projects: db.projects.filter((p) => p.id !== projectId),
        epics: db.epics.filter((e) => e.projectId !== projectId),
        sprints: db.sprints.filter((s) => s.projectId !== projectId),
        milestones: db.milestones.filter((m) => m.projectId !== projectId),
        tasks: db.tasks.filter((t) => t.projectId !== projectId),
        comments: db.comments.filter((c) => !removed.has(c.taskId)),
      };
    });
  const pendingProject = new Map<string, Promise<void>>();
  /** Reloads one project (realtime invalidation, conflict). Concurrent requests share one read. */
  const reloadProject = (projectId: string): Promise<void> => {
    const pending = pendingProject.get(projectId);
    if (pending) return pending;
    const job = loadProject(http, projectId)
      .then(replaceProject)
      .catch((error: unknown) => {
        if (error instanceof ApiError && (error.status === 404 || error.status === 403))
          forgetProject(projectId);
        else if (!(error instanceof ApiError && error.status === 401)) markStale(error);
      })
      .finally(() => pendingProject.delete(projectId));
    pendingProject.set(projectId, job);
    return job;
  };

  /* ------------------------------ policy ------------------------------ */
  const projectOf = (projectId: string) => snapshot.db.projects.find((p) => p.id === projectId);
  const can = (cap: string, projectId?: string): boolean => {
    if (!API_CAPS[roleId()].includes(cap)) return false;
    const writing = WRITE_CAPS.has(cap);
    if (writing && snapshot.sync.stale) return false;
    if (!projectId) return true;
    const project = projectOf(projectId);
    if (!project) return false;
    if (writing && project.archived && cap !== "project.archive") return false;
    const a = actor();
    switch (cap) {
      case "project.edit":
      case "sprint.manage":
      case "task.delete":
        return canManageProject(a, project);
      case "task.create":
        return (
          canManageProject(a, project) &&
          (a.role !== "TEAM_LEAD" || project.teamIds.some((teamId) => a.teamIds.includes(teamId)))
        );
      case "project.archive":
        return canArchiveProject(a);
      case "project.members":
        return canChangeProjectMembership(a);
      case "comment.create":
        return canComment(a);
      default:
        return true;
    }
  };
  const canTouchTask = (task: Task): boolean => {
    if (snapshot.sync.stale) return false;
    const project = projectOf(task.projectId);
    if (!project || project.archived) return false;
    const editable = editableTaskFields(actor(), task);
    return editable === "all" || editable.length > 0;
  };
  const visibleProjects = (db: WorkspaceData = snapshot.db, includeArchived = false) =>
    db.projects.filter((p) => includeArchived || !p.archived);
  const currentUser = (db: WorkspaceData = snapshot.db): User => {
    const user = db.users.find((u) => u.id === claims().sub);
    if (user) return user;
    const c = claims();
    // before the first load (or if the directory omits the person) the shell still has a profile
    return mapMember(
      {
        id: c.sub,
        name: lastMe?.name ?? "",
        email: lastMe?.email ?? "",
        title: lastMe?.title ?? null,
        role: c.role,
        active: true,
        teamIds: c.teamIds,
      },
      c.organizationId,
      readFavorites(),
    );
  };

  /* ------------------------------ writes ------------------------------ */
  const deny = (message = "Seu papel não permite esta ação.") => notify("Sem permissão", message, "err");
  const writable = () => {
    if (!snapshot.sync.stale) return true;
    notify(
      "Serviço indisponível",
      "As alterações ficam desativadas até os dados serem recarregados.",
      "warn",
    );
    return false;
  };
  /** Explains a refused write; conflicts and lost resources reload the project. */
  const fail = (error: unknown, projectId?: string) => {
    if (error instanceof ApiError) {
      if (error.status === 401) return; // session handler
      if (error.status === 409 && /version conflict/i.test(error.message)) {
        notify(CONFLICT_TOAST, "", "warn");
        if (projectId) void reloadProject(projectId);
        return;
      }
      if (error.status === 403) {
        deny();
        if (projectId) void reloadProject(projectId);
        return;
      }
      if (error.status === 404) {
        notify("Não encontrado", "O item não existe mais ou você perdeu o acesso a ele.", "err");
        if (projectId) void reloadProject(projectId);
        return;
      }
      if (isUnavailable(error)) {
        markStale(error);
        notify("Serviço indisponível", "A alteração não foi salva.", "err");
        return;
      }
      notify("Não foi possível concluir", translate(error.message), "err");
      return;
    }
    notify("Não foi possível concluir", error instanceof Error ? error.message : String(error), "err");
  };
  const queues = new Map<string, Promise<unknown>>();
  /** Writes on the same resource run one after another, each with the version the previous one returned. */
  const enqueue = <T>(key: string, job: () => Promise<T>): Promise<T> => {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(job, job);
    queues.set(key, next);
    const cleanup = () => {
      if (queues.get(key) === next) queues.delete(key);
    };
    next.then(cleanup, cleanup);
    return next;
  };
  const versionOf = (id: string) => {
    const version = versions.get(id);
    if (version === undefined) throw new Error("Versão do registro desconhecida; recarregue a página.");
    return version;
  };
  const putTask = (row: ApiTask) => {
    versions.set(row.id, row.version);
    const task = mapTask(row);
    setDb((db) => ({
      ...db,
      tasks: db.tasks.some((t) => t.id === task.id)
        ? db.tasks.map((t) => (t.id === task.id ? task : t))
        : [...db.tasks, task],
    }));
    return task;
  };
  const patchTaskLocal = (id: string, fields: Partial<Task>) =>
    setDb((db) => ({ ...db, tasks: db.tasks.map((t) => (t.id === id ? { ...t, ...fields } : t)) }));

  /** Changed task fields under the API names. */
  const taskPatch = (task: Task, fields: Partial<Task>) => {
    const body: Record<string, unknown> = {};
    const set = (key: keyof Task, apiKey: string, value: unknown = fields[key]) => {
      if (fields[key] !== undefined && !same(fields[key], task[key])) body[apiKey] = value;
    };
    set("title", "title", fields.title?.trim());
    set("desc", "description");
    set("status", "status");
    set("priority", "priority");
    set("assigneeId", "assigneeId", fields.assigneeId ?? null);
    set("teamId", "teamId", fields.teamId ?? null);
    set("sprintId", "sprintId", fields.sprintId ?? null);
    set("epicId", "epicId", fields.epicId ?? null);
    set("labels", "labels");
    set("acceptance", "acceptanceCriteria");
    set("blockedBy", "blockedByIds");
    set("dueDate", "dueDate", fromLocalDayOrNull(fields.dueDate, "end"));
    return body;
  };

  const unavailable = () =>
    notify("Indisponível", "Esta configuração ainda não tem serviço; nada foi alterado.", "warn");
  const readFailure = (error: unknown, message: string) => {
    if (error instanceof ApiError && error.status === 401) return;
    if (isUnavailable(error)) markStale(error);
    else notify("Falha ao carregar", message, "err");
  };
  const mergeAudit = (entries: AuditEntry[]) =>
    setDb((db) => {
      const known = new Set(db.audit.map((entry) => entry.id));
      const added = entries.filter((entry) => !known.has(entry.id));
      if (!added.length) return db;
      return {
        ...db,
        audit: [...db.audit, ...added].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)),
      };
    });
  const archive = async (id: string, restore: boolean) => {
    const project = projectOf(id);
    if (!project || !writable()) return;
    if (!canArchiveProject(actor())) return deny();
    try {
      const row = await enqueue(id, async () => commands.archiveProject(id, versionOf(id), restore));
      versions.set(row.id, row.version);
      const saved = mapProject(row);
      setDb((db) => ({ ...db, projects: db.projects.map((p) => (p.id === id ? saved : p)) }));
      notify(
        restore ? "Projeto restaurado" : "Projeto arquivado",
        restore
          ? `${saved.name} voltou à lista de projetos.`
          : `${saved.name} pode ser restaurado em Projetos → Arquivados.`,
        "ok",
      );
    } catch (error) {
      fail(error, id);
    }
  };

  const act: WorkspaceActions & {
    setMemberActive(id: string, active: boolean): Promise<void>;
  } = {
    dismissToast,
    runAs: (_source, operation) => operation(),
    setTheme(theme) {
      write(THEME_KEY, theme);
      if (theme === "system") {
        try {
          storage?.removeItem(THEME_KEY);
        } catch {
          // blocked storage: the choice lasts for this session
        }
      }
      setDb((db) => ({ ...db, settings: { ...db.settings, theme } }));
    },
    setCurrentProject(id) {
      if (!projectOf(id)) return;
      write(projectKey(), id);
      setDb((db) => ({ ...db, settings: { ...db.settings, currentProjectId: id } }));
    },
    toggleFavorite(id) {
      if (!projectOf(id)) return;
      const me = currentUser();
      const next = me.favoriteProjectIds.includes(id)
        ? me.favoriteProjectIds.filter((x) => x !== id)
        : [...me.favoriteProjectIds, id];
      if (!write(favoritesKey(), JSON.stringify(next)))
        notify("Armazenamento indisponível", "O favorito vale apenas nesta sessão.", "warn");
      setDb((db) => ({
        ...db,
        users: db.users.map((u) => (u.id === me.id ? { ...u, favoriteProjectIds: next } : u)),
      }));
    },

    async createProject(input) {
      if (!writable()) return null;
      if (!canCreateProject(actor())) {
        deny();
        return null;
      }
      try {
        const row = await commands.createProject({
          key: input.key.trim().toUpperCase(),
          name: input.name.trim(),
          description: input.desc ?? "",
          priority: input.priority ?? "medium",
          leadId: input.leadId || null,
          teamIds: input.teamIds ?? [],
          startDate: fromLocalDayOrNull(input.startDate, "start"),
          endDate: fromLocalDayOrNull(input.targetDate, "end"),
        });
        versions.set(row.id, row.version);
        const project = mapProject(row);
        setDb((db) => ({ ...db, projects: [...db.projects, project] }));
        notify("Projeto criado", `${project.name} (${project.key}) está ativo.`, "ok");
        return project;
      } catch (error) {
        fail(error);
        return null;
      }
    },
    async updateProject(id, fields) {
      const project = projectOf(id);
      if (!project || !writable()) return;
      if (!can("project.edit", id)) return deny();
      const body: Record<string, unknown> = {};
      const set = (key: keyof Project, apiKey: string, value: unknown = fields[key]) => {
        if (fields[key] !== undefined && !same(fields[key], project[key])) body[apiKey] = value;
      };
      set("name", "name", fields.name?.trim());
      set("desc", "description");
      set("priority", "priority");
      set("status", "status");
      set("leadId", "leadId", fields.leadId || null);
      set("teamIds", "teamIds");
      set("startDate", "startDate", fromLocalDayOrNull(fields.startDate, "start"));
      set("targetDate", "endDate", fromLocalDayOrNull(fields.targetDate, "end"));
      if (!Object.keys(body).length) return;
      if (("leadId" in body || "teamIds" in body) && !canChangeProjectMembership(actor()))
        return deny("Somente gestores mudam o responsável e as equipes do projeto.");
      setDb((db) => ({ ...db, projects: db.projects.map((p) => (p.id === id ? { ...p, ...fields } : p)) }));
      try {
        const row = await enqueue(id, async () =>
          commands.updateProject(id, { ...body, version: versionOf(id) }),
        );
        versions.set(row.id, row.version);
        const saved = mapProject(row);
        setDb((db) => ({ ...db, projects: db.projects.map((p) => (p.id === id ? saved : p)) }));
        notify("Projeto atualizado", saved.name, "ok");
      } catch (error) {
        setDb((db) => ({ ...db, projects: db.projects.map((p) => (p.id === id ? project : p)) }));
        fail(error, id);
      }
    },
    async archiveProject(id) {
      await archive(id, false);
    },
    async restoreProject(id) {
      await archive(id, true);
    },
    async createEpic(projectId, input) {
      if (!writable()) return null;
      if (!can("project.edit", projectId)) {
        deny();
        return null;
      }
      try {
        const row = await commands.createEpic(projectId, {
          title: input.name.trim(),
          description: input.desc ?? "",
          ownerId: input.ownerId || claims().sub,
        });
        versions.set(row.id, row.version);
        const epic = mapEpic(row);
        setDb((db) => ({ ...db, epics: [...db.epics, epic] }));
        return epic;
      } catch (error) {
        fail(error, projectId);
        return null;
      }
    },
    async createTask(input) {
      const project = projectOf(input.projectId);
      if (!project || !writable()) return null;
      if (!can("task.create", project.id)) {
        deny("Seu papel não permite criar tarefas neste projeto.");
        return null;
      }
      const a = actor();
      const teamId =
        input.teamId ??
        (a.role === "TEAM_LEAD"
          ? project.teamIds.find((team) => a.teamIds.includes(team))
          : project.teamIds[0]) ??
        null;
      if (input.assigneeId && !canAssign(a, input.assigneeId)) {
        deny("Essa pessoa não pode receber tarefas suas.");
        return null;
      }
      try {
        const row = await commands.createTask(project.id, {
          title: input.title.trim(),
          description: input.desc ?? "",
          type: input.parentId ? "subtask" : (input.type ?? "task"),
          status: input.status ?? "todo",
          priority: input.priority ?? "medium",
          assigneeId: input.assigneeId ?? null,
          teamId,
          epicId: input.epicId ?? null,
          sprintId: input.sprintId ?? null,
          parentId: input.parentId ?? null,
          labels: input.labels ?? [],
          acceptanceCriteria: input.acceptance ?? [],
          dueDate: fromLocalDayOrNull(input.dueDate, "end"),
          blockedByIds: input.blockedBy ?? [],
        });
        const task = putTask(row);
        if (!input.silent) notify("Tarefa criada", `${task.ref} — ${task.title}`, "ok");
        return task;
      } catch (error) {
        fail(error, project.id);
        return null;
      }
    },
    async updateTask(id, fields) {
      const task = snapshot.db.tasks.find((t) => t.id === id);
      if (!task || !writable()) return;
      const body = taskPatch(task, fields);
      const keys = Object.keys(body);
      if (!keys.length) return;
      const a = actor();
      if (!canTouchTask(task) || !canEditTaskFields(a, task, keys))
        return deny("Seu papel não permite editar isso nesta tarefa.");
      if ("assigneeId" in body && !canAssign(a, body.assigneeId as string | null))
        return deny("Essa pessoa não pode receber tarefas suas.");
      const optimistic: Partial<Task> = { ...fields, updatedAt: now().toISOString() };
      if (fields.status && fields.status !== task.status)
        optimistic.doneAt = fields.status === "done" ? now().toISOString() : null;
      patchTaskLocal(id, optimistic);
      try {
        const row = await enqueue(id, () =>
          keys.length === 1 && keys[0] === "status"
            ? commands.moveTask(id, { version: versionOf(id), status: body.status as Task["status"] })
            : commands.updateTask(id, { ...body, version: versionOf(id) }),
        );
        putTask(row);
      } catch (error) {
        patchTaskLocal(id, task);
        fail(error, task.projectId);
      }
    },
    moveTask(id, status) {
      return act.updateTask(id, { status });
    },
    async deleteTask(id) {
      const task = snapshot.db.tasks.find((t) => t.id === id);
      if (!task || !writable()) return;
      if (!can("task.delete", task.projectId)) return deny();
      try {
        await enqueue(id, () => commands.deleteTask(id, versionOf(id)));
        versions.delete(id);
        setDb((db) => ({
          ...db,
          tasks: db.tasks
            .filter((t) => t.id !== id)
            .map((t) =>
              t.blockedBy.includes(id) ? { ...t, blockedBy: t.blockedBy.filter((x) => x !== id) } : t,
            ),
          comments: db.comments.filter((c) => c.taskId !== id),
        }));
        notify("Tarefa excluída", task.ref, "ok");
      } catch (error) {
        fail(error, task.projectId);
      }
    },
    async addComment(taskId, text) {
      const task = snapshot.db.tasks.find((t) => t.id === taskId);
      if (!task || !writable()) return;
      if (!can("comment.create", task.projectId)) return deny("Seu papel não permite comentar.");
      try {
        const comment = mapComment(await commands.createComment(taskId, text.trim()));
        setDb((db) => ({ ...db, comments: [...db.comments, comment] }));
      } catch (error) {
        fail(error, task.projectId);
      }
    },
    async createSprint(projectId, input) {
      if (!writable()) return null;
      if (!can("sprint.manage", projectId)) {
        deny();
        return null;
      }
      try {
        const row = await commands.createSprint(projectId, {
          name: input.name.trim(),
          goal: input.goal ?? "",
          startDate: fromLocalDay(input.startDate, "start"),
          endDate: fromLocalDay(input.endDate, "end"),
        });
        versions.set(row.id, row.version);
        const sprint = mapSprint(row);
        setDb((db) => ({ ...db, sprints: [...db.sprints, sprint] }));
        return sprint;
      } catch (error) {
        fail(error, projectId);
        return null;
      }
    },
    async startSprint(id) {
      const sprint = snapshot.db.sprints.find((s) => s.id === id);
      if (!sprint || !writable()) return;
      if (!can("sprint.manage", sprint.projectId)) return deny();
      try {
        const row = await enqueue(id, async () => commands.startSprint(id, versionOf(id)));
        versions.set(row.id, row.version);
        const saved = mapSprint(row);
        setDb((db) => ({ ...db, sprints: db.sprints.map((s) => (s.id === id ? saved : s)) }));
        notify("Sprint iniciada", `${saved.name} está ativa.`, "ok");
      } catch (error) {
        fail(error, sprint.projectId);
      }
    },
    async completeSprint(id) {
      const sprint = snapshot.db.sprints.find((s) => s.id === id);
      if (!sprint || !writable()) return;
      if (!can("sprint.manage", sprint.projectId)) return deny();
      try {
        const result = await enqueue(id, async () => commands.completeSprint(id, versionOf(id)));
        const moved =
          typeof result === "object" && result !== null && "movedToBacklog" in result
            ? Number((result as { movedToBacklog: unknown }).movedToBacklog)
            : 0;
        // unfinished tasks went back to the backlog in the same transaction: read the project again
        await reloadProject(sprint.projectId);
        notify(
          "Sprint encerrada",
          moved
            ? `${sprint.name}: ${plural(moved, "tarefa voltou", "tarefas voltaram")} ao backlog.`
            : `${sprint.name}: todas as tarefas foram concluídas.`,
          "ok",
        );
      } catch (error) {
        fail(error, sprint.projectId);
      }
    },
    async createMilestone(projectId, input) {
      if (!writable()) return null;
      if (!can("project.edit", projectId)) {
        deny();
        return null;
      }
      try {
        const row = await commands.createMilestone(projectId, {
          name: input.name.trim(),
          date: fromLocalDay(input.date, "end"),
        });
        versions.set(row.id, row.version);
        const milestone = mapMilestone(row);
        setDb((db) => ({ ...db, milestones: [...db.milestones, milestone] }));
        return milestone;
      } catch (error) {
        fail(error, projectId);
        return null;
      }
    },
    async updateMilestone(id, fields: Partial<Milestone>) {
      const milestone = snapshot.db.milestones.find((m) => m.id === id);
      if (!milestone || !writable()) return;
      if (!can("project.edit", milestone.projectId)) return deny();
      const body: Record<string, unknown> = {};
      if (fields.name !== undefined && fields.name !== milestone.name) body.name = fields.name.trim();
      if (fields.date !== undefined && fields.date !== milestone.date)
        body.date = fromLocalDay(fields.date, "end");
      if (fields.status !== undefined && fields.status !== milestone.status)
        body.completed = fields.status === "done";
      if (!Object.keys(body).length) return;
      setDb((db) => ({
        ...db,
        milestones: db.milestones.map((m) => (m.id === id ? { ...m, ...fields } : m)),
      }));
      try {
        const row = await enqueue(id, async () =>
          commands.updateMilestone(id, { ...body, version: versionOf(id) }),
        );
        versions.set(row.id, row.version);
        const saved = mapMilestone(row);
        setDb((db) => ({ ...db, milestones: db.milestones.map((m) => (m.id === id ? saved : m)) }));
      } catch (error) {
        setDb((db) => ({ ...db, milestones: db.milestones.map((m) => (m.id === id ? milestone : m)) }));
        fail(error, milestone.projectId);
      }
    },
    setNotifPref() {
      unavailable();
    },
    resendNotification() {
      unavailable();
    },
    setProvider() {
      unavailable();
    },
    async setUserRole(id, next) {
      const user = snapshot.db.users.find((u) => u.id === id);
      if (!user || !writable()) return;
      if (!can("user.manage")) return deny();
      try {
        const saved = await commands.updateMember(id, { role: toApiRole(next) });
        setDb((db) => ({
          ...db,
          users: db.users.map((u) => (u.id === id ? { ...u, roleId: toRoleId(saved.role) } : u)),
        }));
        notify("Papel atualizado", "Vale a partir do próximo acesso da pessoa (até 5 minutos).", "ok");
      } catch (error) {
        fail(error);
      }
    },
    async setMemberActive(id, active) {
      const user = snapshot.db.users.find((u) => u.id === id);
      if (!user || !writable()) return;
      if (!can("user.manage")) return deny();
      try {
        const saved = await commands.updateMember(id, { active });
        setDb((db) => ({
          ...db,
          users: db.users.map((u) => (u.id === id ? { ...u, active: saved.active } : u)),
        }));
        notify(active ? "Acesso reativado" : "Acesso desativado", user.name, "ok");
      } catch (error) {
        fail(error);
      }
    },
    inviteUser() {
      notify("Use o convite por link", "Convites são criados em Usuários e permissões.", "info");
      return null;
    },
    loadTask(id) {
      const task = snapshot.db.tasks.find((t) => t.id === id);
      if (!task) return;
      void loadComments(http, id)
        .then((rows) => {
          const comments = rows.map(mapComment).sort(byCreated);
          setDb((db) => ({ ...db, comments: [...db.comments.filter((c) => c.taskId !== id), ...comments] }));
        })
        .catch((error: unknown) => readFailure(error, "Não foi possível carregar os comentários."));
      if (!API_CAPS[roleId()].includes("audit.view")) return;
      void loadAudit(http, { aggregateId: id }, 1)
        .then((events) => {
          const entries = events.map((event) => mapAuditEvent(event, userNames(snapshot.db.users)));
          mergeAudit(entries);
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 403) return; // trail outside the role
          readFailure(error, "Não foi possível carregar o histórico.");
        });
    },
  };
  const base: WorkspaceStore = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    act,
    can,
    canTouchTask,
    visibleProjects,
    currentUser,
    notify,
  };
  return Object.assign(base, {
    act,
    /** First and full reads (the banner's "Tentar novamente"). */
    load,
    reloadProject,
    commands,
    isLoaded: () => loaded,
    versionOf: (id: string) => versions.get(id),
    /** Companies of the signed-in account (GET /me), for the organization switcher. */
    memberships: () => lastMe?.memberships ?? [],
  });
}
export type ApiWorkspaceStore = ReturnType<typeof createApiStore>;
