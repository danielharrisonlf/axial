import { useMemo, useSyncExternalStore } from "react";
import { API_MODE } from "./source";
import type {
  Epic,
  Milestone,
  NotificationChannel,
  NotificationProvider,
  Project,
  ProjectInput,
  RoleId,
  Sprint,
  SprintInput,
  Task,
  TaskInput,
  TaskStatus,
  Theme,
  Toast,
  ToastTone,
  User,
  WorkspaceData,
} from "./types";

/**
 * Capabilities of the local demonstration (prototype rules). The demo store enforces them;
 * the API mode uses {@link API_CAPS}, which follow the ms-projects policy instead.
 */
export const DEMO_CAPS: Record<RoleId, string[]> = {
  admin: [
    "project.view",
    "project.create",
    "project.edit",
    "project.archive",
    "project.members",
    "task.view",
    "task.create",
    "task.edit",
    "task.move",
    "task.assign",
    "task.delete",
    "comment.create",
    "sprint.view",
    "sprint.manage",
    "team.view",
    "team.manage",
    "user.manage",
    "notif.view",
    "notif.manage",
    "audit.view",
    "insights.view",
  ],
  pm: [
    "project.view",
    "project.create",
    "project.edit",
    "project.archive",
    "project.members",
    "task.view",
    "task.create",
    "task.edit",
    "task.move",
    "task.assign",
    "task.delete",
    "comment.create",
    "sprint.view",
    "sprint.manage",
    "team.view",
    "notif.view",
    "audit.view",
    "insights.view",
  ],
  lead: [
    "project.view",
    "task.view",
    "task.create",
    "task.edit",
    "task.move",
    "task.assign",
    "comment.create",
    "sprint.view",
    "team.view",
    "team.manage",
    "notif.view",
    "audit.view",
    "insights.view",
  ],
  dev: [
    "project.view",
    "task.view",
    "task.create",
    "task.edit",
    "task.move",
    "comment.create",
    "sprint.view",
    "team.view",
    "notif.view",
  ],
  viewer: ["project.view", "task.view", "sprint.view", "team.view", "notif.view", "insights.view"],
};

/**
 * Role capabilities on the real backend (packages/contracts policy.ts, ms-identity, ms-audit).
 * They only shape the interface; every write is authorized again by the service. TEAM_LEAD
 * capabilities are limited to projects of its teams and CONTRIBUTOR edits only tasks assigned
 * to it; the API store refines these per project and per task.
 */
export const API_CAPS: Record<RoleId, string[]> = {
  admin: DEMO_CAPS.admin.filter((cap) => cap !== "notif.manage"),
  pm: DEMO_CAPS.pm,
  lead: [
    "project.view",
    "project.edit",
    "task.view",
    "task.create",
    "task.edit",
    "task.move",
    "task.assign",
    "task.delete",
    "comment.create",
    "sprint.view",
    "sprint.manage",
    "team.view",
    "notif.view",
    "audit.view",
    "insights.view",
  ],
  dev: [
    "project.view",
    "task.view",
    "task.edit",
    "task.move",
    "comment.create",
    "sprint.view",
    "team.view",
    "notif.view",
  ],
  viewer: DEMO_CAPS.viewer,
};

export const CAPABILITY_MATRIX: { group: string; items: { cap: string; label: string }[] }[] = [
  {
    group: "Projetos",
    items: [
      { cap: "project.view", label: "ver projetos" },
      { cap: "project.create", label: "criar projetos" },
      { cap: "project.edit", label: "editar projetos" },
      { cap: "project.archive", label: "arquivar" },
    ],
  },
  {
    group: "Tarefas",
    items: [
      { cap: "task.view", label: "ver tarefas" },
      { cap: "task.create", label: "criar" },
      { cap: "task.edit", label: "editar" },
      { cap: "task.move", label: "mover status" },
      { cap: "task.assign", label: "atribuir" },
      { cap: "task.delete", label: "excluir" },
    ],
  },
  {
    group: "Sprints e equipes",
    items: [
      { cap: "sprint.view", label: "ver sprints" },
      { cap: "sprint.manage", label: "gerenciar sprints" },
      { cap: "team.manage", label: "gerenciar a própria equipe" },
      { cap: "user.manage", label: "gerenciar usuários" },
    ],
  },
  {
    group: "Análise",
    items: [
      { cap: "insights.view", label: "acessar Insights" },
      { cap: "audit.view", label: "central de auditoria" },
    ],
  },
];

export function roleHasCapability(roleId: RoleId, cap: string): boolean {
  return (API_MODE ? API_CAPS : DEMO_CAPS)[roleId].includes(cap);
}

type Awaitable<T> = T | Promise<T>;

/** Freshness of API data. Absent in the demo, whose data is local. */
export interface SyncState {
  /** The last read failed: data on screen is the last fetched copy and writes are disabled. */
  stale: boolean;
  /** Why the data is stale, in Portuguese. */
  message: string | null;
  /** A reload is in progress. */
  refreshing: boolean;
}
export interface WorkspaceSnapshot {
  db: WorkspaceData;
  toasts: Toast[];
  sync?: SyncState;
}

/**
 * Operations of the Workspace. The demo answers synchronously; the API store applies optimistic
 * changes at once and resolves when the service confirms, so callers `await` the result.
 */
export interface WorkspaceActions {
  dismissToast(id: string): void;
  /** Runs actions as another origin (the demo MCP console records "mcp" in the audit trail). */
  runAs<T>(source: "ui" | "mcp" | "api" | "automation", operation: () => T): T;
  setTheme(theme: Theme): void;
  setCurrentProject(id: string): void;
  createProject(input: ProjectInput): Awaitable<Project | null>;
  updateProject(id: string, fields: Partial<Project>): Awaitable<void>;
  archiveProject(id: string): Awaitable<void>;
  restoreProject(id: string): Awaitable<void>;
  toggleFavorite(id: string): void;
  createEpic(
    projectId: string,
    input: { name: string; desc?: string; ownerId?: string },
  ): Awaitable<Epic | null>;
  createTask(input: TaskInput): Awaitable<Task | null>;
  updateTask(id: string, fields: Partial<Task>): Awaitable<void>;
  moveTask(id: string, status: TaskStatus): Awaitable<void>;
  deleteTask(id: string): Awaitable<void>;
  addComment(taskId: string, text: string): Awaitable<void>;
  createSprint(projectId: string, input: SprintInput): Awaitable<Sprint | null>;
  startSprint(id: string): Awaitable<void>;
  completeSprint(id: string): Awaitable<void>;
  createMilestone(projectId: string, input: { name: string; date: string }): Awaitable<Milestone | null>;
  updateMilestone(id: string, fields: Partial<Milestone>): Awaitable<void>;
  setNotifPref(eventType: string, channel: NotificationChannel, enabled: boolean): void;
  resendNotification(id: string): void;
  setProvider(
    channel: NotificationChannel,
    fields: Pick<NotificationProvider, "from" | "host" | "configured">,
  ): void;
  setUserRole(id: string, roleId: RoleId): Awaitable<void>;
  inviteUser(input: {
    name: string;
    email: string;
    title: string;
    roleId: RoleId;
    teamIds: string[];
  }): Awaitable<User | null>;
  /** Loads what a task drawer shows on demand (comments, history). Absent in the demo. */
  loadTask?(id: string): void;
}

export interface WorkspaceStore {
  getSnapshot(): WorkspaceSnapshot;
  subscribe(listener: () => void): () => void;
  act: WorkspaceActions;
  /** Role capability; with a project id, the API store also applies the per-project policy. */
  can(cap: string, projectId?: string): boolean;
  canTouchTask(task: Task): boolean;
  visibleProjects(db?: WorkspaceData, includeArchived?: boolean): Project[];
  currentUser(db?: WorkspaceData): User;
  notify(title: string, message?: string, tone?: ToastTone): void;
}

let active: WorkspaceStore | null = null;
/** Selects the store the hooks read (once for the demo; per signed-in organization for the API). */
export function installWorkspaceStore(store: WorkspaceStore): void {
  active = store;
}
function current(): WorkspaceStore {
  if (!active) throw new Error("Workspace store is not installed");
  return active;
}
/** Stable facade over the installed store, for code outside React render (event handlers, cleanups). */
export const workspaceStore: WorkspaceStore = {
  getSnapshot: () => current().getSnapshot(),
  subscribe: (listener) => current().subscribe(listener),
  get act() {
    return current().act;
  },
  can: (cap, projectId) => current().can(cap, projectId),
  canTouchTask: (task) => current().canTouchTask(task),
  visibleProjects: (db, includeArchived) => current().visibleProjects(db, includeArchived),
  currentUser: (db) => current().currentUser(db),
  notify: (title, message, tone) => current().notify(title, message, tone),
};

export function useWorkspace() {
  const store = current();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // Derived collections keep a stable identity between renders. Without this,
  // consumers such as the Insights remote would see a new array on every
  // render and restart their effects (which cancelled the first remote mount).
  const visibleProjects = useMemo(() => store.visibleProjects(snapshot.db), [store, snapshot.db]);
  const accessibleProjects = useMemo(() => store.visibleProjects(snapshot.db, true), [store, snapshot.db]);
  const projectIds = useMemo(() => new Set(visibleProjects.map((p) => p.id)), [visibleProjects]);
  const visibleTasks = useMemo(
    () => snapshot.db.tasks.filter((t) => projectIds.has(t.projectId)),
    [snapshot.db.tasks, projectIds],
  );
  const me = useMemo(() => store.currentUser(snapshot.db), [store, snapshot.db]);
  const favoriteIds = useMemo(() => new Set(me.favoriteProjectIds), [me]);
  /** Own deliveries; admin and project managers (who see every project of the organization) also
   * see the organization's. The page and the bell use this same list. */
  const visibleNotifications = useMemo(() => {
    const orgWide = me.roleId === "admin" || me.roleId === "pm";
    return snapshot.db.notifications.filter((n) => {
      if (n.toUserId === me.id) return true;
      if (!orgWide) return false;
      const to = snapshot.db.users.find((u) => u.id === n.toUserId);
      return !!to && (me.roleId === "admin" || to.orgId === me.orgId);
    });
  }, [snapshot.db.notifications, snapshot.db.users, me]);
  return {
    ...snapshot,
    me,
    visibleNotifications,
    /** Favorites of the current profile (seed 9 keeps them per person). */
    isFavorite: (projectId: string) => favoriteIds.has(projectId),
    visibleProjects,
    accessibleProjects,
    visibleTasks,
    can: store.can,
    canTouchTask: store.canTouchTask,
    act: store.act,
    notify: store.notify,
  };
}
