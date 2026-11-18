import { useMemo, useSyncExternalStore } from "react";
import { PRIO_META, plural, ROLE_LABEL, STATUS_META, todayLocal } from "../lib/format";
import { workspaceDataSchema } from "./schema";
import { createDemoData, type LegacyData, migrateToCurrent } from "./seed";
import type {
  AuditEntry,
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

export const STORAGE_KEY = "axial.workspace.demo.v1";
const CAPS: Record<RoleId, string[]> = {
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
    "sprint.view",
    "team.view",
    "notif.view",
  ],
  viewer: ["project.view", "task.view", "sprint.view", "team.view", "notif.view", "insights.view"],
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

/** What a capability allows, in the words of the denial message ("O perfil “X” não pode …"). */
const CAP_ACTION: Record<string, string> = {
  "project.create": "criar projetos",
  "project.edit": "editar projetos",
  "project.archive": "arquivar ou restaurar projetos",
  "task.create": "criar tarefas",
  "task.edit": "editar tarefas",
  "task.move": "mover tarefas",
  "task.assign": "atribuir tarefas a outras pessoas",
  "task.delete": "excluir tarefas",
  "sprint.manage": "gerenciar sprints",
  "team.manage": "gerenciar equipes",
  "user.manage": "gerenciar usuários",
  "notif.manage": "alterar notificações e provedores",
};
export function roleHasCapability(roleId: RoleId, cap: string): boolean {
  return CAPS[roleId].includes(cap);
}
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface WorkspaceSnapshot {
  db: WorkspaceData;
  toasts: Toast[];
}
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** This repository contains fictional, local-only data. It never pretends an HTTP call succeeded. */
export function createWorkspaceStore(
  options: { storage?: StoragePort; now?: () => Date; initialData?: WorkspaceData } = {},
) {
  const now = options.now ?? (() => new Date());
  const storage = options.storage;
  let initial = options.initialData ?? createDemoData(now());
  let recovery = false;
  if (storage && !options.initialData) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = workspaceDataSchema.safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.users.some((u) => u.id === parsed.data.settings.currentUserId)) {
          const saved = parsed.data as unknown as LegacyData;
          const previousVersion = saved.meta.seedVersion;
          initial = migrateToCurrent(saved, now());
          // the upgrade is written back at once, so a reload does not migrate again
          if (initial.meta.seedVersion !== previousVersion)
            storage.setItem(STORAGE_KEY, JSON.stringify(initial));
        } else recovery = true;
      }
    } catch {
      recovery = true;
    }
  }
  let snapshot: WorkspaceSnapshot = { db: initial, toasts: [] };
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const getSnapshot = () => snapshot;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const currentUser = (db = snapshot.db) => {
    const user = db.users.find((u) => u.id === db.settings.currentUserId);
    if (!user) throw new Error("Perfil da demonstração não encontrado");
    return user;
  };
  const can = (cap: string) => CAPS[currentUser().roleId].includes(cap);
  const visibleProjects = (db = snapshot.db, includeArchived = false) => {
    const me = currentUser(db);
    return db.projects.filter(
      (p) =>
        (includeArchived || !p.archived) &&
        (me.roleId === "admin" ||
          (p.orgId === me.orgId &&
            (me.roleId === "pm" ||
              me.roleId === "viewer" ||
              p.leadId === me.id ||
              p.teamIds.some((t) => me.teamIds.includes(t))))),
    );
  };
  const canSee = (projectId: string) => visibleProjects().some((p) => p.id === projectId);
  const canTouchTask = (task: Task) => {
    const me = currentUser();
    if (!can("task.edit") || !canSee(task.projectId)) return false;
    if (me.roleId === "admin" || me.roleId === "pm") return true;
    // unassigned tasks are open to anyone who works on the project, leads included
    if (me.roleId === "lead")
      return (
        (task.teamId !== null && me.teamIds.includes(task.teamId)) ||
        task.assigneeId === me.id ||
        !task.assigneeId
      );
    return task.assigneeId === me.id || task.createdBy === me.id || !task.assigneeId;
  };
  /** Toasts: identical ones are grouped with a counter; at most three stay visible (oldest leaves). */
  const MAX_TOASTS = 3;
  const notify = (title: string, message = "", tone: ToastTone = "info") => {
    const same = snapshot.toasts.find((t) => t.title === title && t.message === message && t.tone === tone);
    const toasts = same
      ? snapshot.toasts.map((t) => (t === same ? { ...t, count: t.count + 1 } : t))
      : [...snapshot.toasts, { id: uid("toast"), title, message, tone, count: 1 }].slice(-MAX_TOASTS);
    snapshot = { ...snapshot, toasts };
    emit();
  };
  const dismissToast = (id: string) => {
    snapshot = { ...snapshot, toasts: snapshot.toasts.filter((t) => t.id !== id) };
    emit();
  };
  let storageWarned = false;
  const commit = (db: WorkspaceData) => {
    snapshot = { ...snapshot, db };
    if (storage) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(db));
      } catch {
        if (!storageWarned) {
          storageWarned = true;
          notify("Armazenamento indisponível", "As alterações serão mantidas apenas nesta sessão.", "warn");
        }
      }
    }
    emit();
  };
  /** Origin written to audit entries; actions run through `act.runAs` record another origin (e.g. "mcp"). */
  let auditSource = "ui";
  const audit = (
    db: WorkspaceData,
    action: string,
    entityType: string,
    entityId: string,
    projectId: string | null,
    summary: string,
    before: unknown = null,
    after: unknown = null,
  ) => {
    // updates record only what changed; arrays and objects compare by value (no spurious diffs)
    if (before && after && typeof before === "object" && typeof after === "object") {
      const b = before as Record<string, unknown>;
      const a = after as Record<string, unknown>;
      const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
        (key) => key !== "updatedAt" && JSON.stringify(b[key]) !== JSON.stringify(a[key]),
      );
      before = Object.fromEntries(keys.map((key) => [key, b[key] ?? null]));
      after = Object.fromEntries(keys.map((key) => [key, a[key] ?? null]));
    }
    const entry: AuditEntry = {
      id: uid("au"),
      ts: now().toISOString(),
      userId: db.settings.currentUserId,
      action,
      entityType,
      entityId,
      projectId,
      before: structuredClone(before),
      after: structuredClone(after),
      summary,
      source: auditSource,
    };
    db.audit.unshift(entry);
  };
  const deny = (what: string) => {
    write((db) => {
      audit(db, "denied", "permission", "permission", null, `tentativa sem permissão: ${what}`);
    });
    notify("Sem permissão", `O perfil “${ROLE_LABEL[currentUser().roleId]}” não pode ${what}.`, "err");
  };
  const guard = (cap: string, what?: string) => {
    if (can(cap)) return true;
    deny(what ?? CAP_ACTION[cap] ?? "realizar esta ação");
    return false;
  };
  /** Without task.assign a person may only take a task or drop their own assignment (prototype assignAllowed). */
  const assignAllowed = (from: string | null, to: string | null) => {
    if (can("task.assign")) return true;
    const me = currentUser().id;
    return to === me || (to === null && from === me);
  };
  const write = <T>(operation: (db: WorkspaceData) => T): T | null => {
    try {
      const db = structuredClone(snapshot.db);
      const result = operation(db);
      commit(db);
      return result;
    } catch (error) {
      notify(
        "Não foi possível concluir",
        error instanceof Error ? error.message : "Revise os dados e tente novamente.",
        "err",
      );
      return null;
    }
  };
  const projectFor = (db: WorkspaceData, id: string) => {
    const project = db.projects.find((p) => p.id === id);
    if (!project || !canSee(id)) throw new Error("Projeto não encontrado para este perfil.");
    if (project.archived) throw new Error("Projetos arquivados são somente leitura.");
    return project;
  };
  const validateDates = (start?: string | null, end?: string | null) => {
    if (start && end && start > end) throw new Error("A data final deve ser posterior à data inicial.");
  };
  const taskFor = (db: WorkspaceData, id: string) => {
    const task = db.tasks.find((t) => t.id === id);
    if (!task) throw new Error("Tarefa não encontrada.");
    projectFor(db, task.projectId);
    return task;
  };
  const validateProjectReferences = (db: WorkspaceData, organizationId: string, fields: Partial<Project>) => {
    if (
      fields.leadId &&
      !db.users.some((u) => u.id === fields.leadId && u.orgId === organizationId && u.active)
    )
      throw new Error("Responsável fora da organização do projeto.");
    if (
      fields.teamIds?.some((id) => !db.teams.some((team) => team.id === id && team.orgId === organizationId))
    )
      throw new Error("Equipe fora da organização do projeto.");
  };
  const validateTaskReferences = (db: WorkspaceData, p: Project, input: Partial<Task>, taskId?: string) => {
    if (
      input.assigneeId &&
      !db.users.some((u) => u.id === input.assigneeId && u.orgId === p.orgId && u.active)
    )
      throw new Error("Responsável fora da organização do projeto.");
    if (
      input.teamId &&
      (!p.teamIds.includes(input.teamId) ||
        !db.teams.some((t) => t.id === input.teamId && t.orgId === p.orgId))
    )
      throw new Error("Equipe fora do projeto.");
    if (input.epicId && !db.epics.some((e) => e.id === input.epicId && e.projectId === p.id))
      throw new Error("Épico fora do projeto.");
    if (input.sprintId) {
      const sprint = db.sprints.find((s) => s.id === input.sprintId && s.projectId === p.id);
      if (!sprint || sprint.status === "done") throw new Error("Sprint indisponível neste projeto.");
    }
    if (
      input.parentId &&
      !db.tasks.some((t) => t.id === input.parentId && t.projectId === p.id && !t.parentId)
    )
      throw new Error("Tarefa principal fora do projeto.");
    if (input.blockedBy) {
      const target = taskId ?? input.parentId;
      const reaches = (candidate: string, seen: Set<string>): boolean => {
        const task = db.tasks.find((t) => t.id === candidate && t.projectId === p.id);
        if (!task) throw new Error("Dependência fora do projeto.");
        if (candidate === target) return true;
        if (seen.has(candidate)) return false;
        seen.add(candidate);
        const implicitChildren = db.tasks.filter((t) => t.parentId === candidate).map((t) => t.id);
        return [...task.blockedBy, ...implicitChildren].some((next) => reaches(next, seen));
      };
      if (new Set(input.blockedBy).size !== input.blockedBy.length)
        throw new Error("Dependências repetidas.");
      if (input.blockedBy.some((id) => reaches(id, new Set())))
        throw new Error("Essa dependência criaria um ciclo.");
    }
  };
  const notificationChannels: NotificationChannel[] = ["email", "whatsapp", "sms"];
  const CHANNEL_LABEL: Record<NotificationChannel, string> = {
    email: "e-mail",
    whatsapp: "WhatsApp",
    sms: "SMS",
  };
  const fillTemplate = (value: string, vars: Record<string, string>) =>
    Object.entries(vars).reduce(
      (text, [key, replacement]) => text.split(`{${key}}`).join(replacement),
      value,
    );
  /**
   * Mirrors the prototype's event fan-out: enabled event/channel pairs become deliveries.
   * Channels without a configured provider are recorded as failed, never as delivered.
   */
  const queueNotifications = (
    db: WorkspaceData,
    eventType: string,
    toUserId: string,
    vars: Record<string, string>,
  ) => {
    const template = db.notificationTemplates.find((item) => item.event === eventType);
    const preferences = db.notificationPreferences[eventType];
    if (!template || !preferences) return;
    if (!db.users.some((user) => user.id === toUserId && user.active)) return;
    for (const channel of notificationChannels) {
      if (!preferences[channel]) continue;
      const provider = db.notificationProviders[channel];
      db.notifications.unshift({
        id: uid("nf"),
        ts: now().toISOString(),
        channel,
        templateId: template.id,
        eventType,
        toUserId,
        subject: fillTemplate(template.subject, vars),
        body: fillTemplate(template.body, vars),
        status: provider.configured ? "delivered" : "failed",
        attempts: 1,
        failReason: provider.configured
          ? null
          : `Provedor de ${channel === "whatsapp" ? "WhatsApp" : channel.toUpperCase()} não configurado`,
      });
    }
    db.notifications = db.notifications.slice(0, 200);
  };
  const taskNotificationVars = (db: WorkspaceData, task: Task, projectName: string) => {
    const user = db.users.find((item) => item.id === task.assigneeId);
    return {
      ref: task.ref,
      nome: user ? (user.name.split(" ")[0] ?? user.name) : "",
      titulo: task.title,
      projeto: projectName,
    };
  };
  const act = {
    dismissToast,
    /** Runs actions as another origin (the MCP test console records "mcp" in the audit trail). */
    runAs<T>(source: "ui" | "mcp" | "api" | "automation", operation: () => T): T {
      const previous = auditSource;
      auditSource = source;
      try {
        return operation();
      } finally {
        auditSource = previous;
      }
    },
    setTheme(theme: Theme) {
      write((db) => {
        db.settings.theme = theme;
      });
    },
    setUser(id: string) {
      write((db) => {
        if (!db.users.some((u) => u.id === id && u.active)) throw new Error("Perfil indisponível");
        db.settings.currentUserId = id;
        // messages of the previous profile do not follow the switch
        snapshot = { ...snapshot, toasts: [] };
      });
    },
    setCurrentProject(id: string) {
      write((db) => {
        if (!canSee(id)) throw new Error("Projeto não disponível");
        db.settings.currentProjectId = id;
      });
    },
    createProject(input: ProjectInput): Project | null {
      if (!guard("project.create")) return null;
      const result = write((db) => {
        const key = input.key.trim().toUpperCase();
        const name = input.name.trim();
        if (!/^[A-Z][A-Z0-9]{1,11}$/.test(key))
          throw new Error("Informe uma chave de 2 a 12 letras/números, começando por letra.");
        if (!name) throw new Error("Informe o nome do projeto.");
        if (db.projects.some((p) => p.key === key && p.orgId === currentUser().orgId))
          throw new Error("Chave já usada por outro projeto.");
        validateDates(input.startDate, input.targetDate);
        validateProjectReferences(db, currentUser().orgId, input);
        const project: Project = {
          id: uid("prj"),
          orgId: currentUser().orgId,
          key,
          name,
          desc: input.desc ?? "",
          teamIds: input.teamIds ?? [],
          leadId: input.leadId || currentUser().id,
          priority: input.priority ?? "medium",
          status: "active",
          startDate: input.startDate || todayLocal(0, now()),
          targetDate: input.targetDate || null,
          archived: false,
          createdAt: now().toISOString(),
          color: "#2B5FD9",
        };
        db.projects.push(project);
        db.taskCounters[project.id] = 0;
        audit(
          db,
          "create",
          "project",
          project.id,
          project.id,
          `criou o projeto ${project.name}`,
          null,
          project,
        );
        return project;
      });
      if (result) notify("Projeto criado", `${result.name} (${result.key}) está ativo.`, "ok");
      return result;
    },
    updateProject(id: string, fields: Partial<Project>) {
      if (!guard("project.edit")) return;
      const saved = write((db) => {
        const project = projectFor(db, id);
        validateProjectReferences(db, project.orgId, fields);
        validateDates(
          fields.startDate ?? project.startDate,
          fields.targetDate === undefined ? project.targetDate : fields.targetDate,
        );
        if (fields.name !== undefined && !fields.name.trim()) throw new Error("Informe o nome do projeto.");
        if (fields.startDate !== undefined && !fields.startDate) throw new Error("Informe a data de início.");
        const before = structuredClone(project);
        const allowed = [
          "name",
          "desc",
          "teamIds",
          "leadId",
          "priority",
          "status",
          "startDate",
          "targetDate",
        ] as const;
        for (const field of allowed)
          if (fields[field] !== undefined) Object.assign(project, { [field]: fields[field] });
        audit(db, "update", "project", id, id, `atualizou o projeto ${project.name}`, before, project);
        return project.name;
      });
      if (saved) notify("Projeto atualizado", saved, "ok");
    },
    archiveProject(id: string) {
      if (!guard("project.archive")) return;
      const name = write((db) => {
        const p = projectFor(db, id);
        p.archived = true;
        audit(db, "archive", "project", id, id, `arquivou o projeto ${p.name}`);
        return p.name;
      });
      if (name) notify("Projeto arquivado", `${name} pode ser restaurado em Projetos → Arquivados.`, "ok");
    },
    restoreProject(id: string) {
      if (!guard("project.archive")) return;
      const restored = write((db) => {
        const p = visibleProjects(db, true).find((p) => p.id === id);
        if (!p) throw new Error("Projeto não encontrado.");
        p.archived = false;
        audit(db, "restore", "project", id, id, `restaurou o projeto ${p.name}`);
        return p.name;
      });
      if (restored) notify("Projeto restaurado", `${restored} voltou à lista de projetos.`, "ok");
    },
    toggleFavorite(id: string) {
      write((db) => {
        if (!db.projects.some((p) => p.id === id) || !canSee(id)) throw new Error("Projeto não disponível");
        const me = db.users.find((u) => u.id === db.settings.currentUserId);
        if (!me) throw new Error("Perfil da demonstração não encontrado");
        me.favoriteProjectIds = me.favoriteProjectIds.includes(id)
          ? me.favoriteProjectIds.filter((x) => x !== id)
          : [...me.favoriteProjectIds, id];
      });
    },
    createEpic(projectId: string, input: { name: string; desc?: string; ownerId?: string }): Epic | null {
      if (!guard("task.create")) return null;
      return write((db) => {
        projectFor(db, projectId);
        if (!input.name.trim()) throw new Error("Informe o nome do épico.");
        const epic: Epic = {
          id: uid("ep"),
          projectId,
          name: input.name.trim(),
          desc: input.desc ?? "",
          ownerId: input.ownerId ?? currentUser().id,
          status: "active",
        };
        db.epics.push(epic);
        audit(db, "create", "epic", epic.id, projectId, `criou o épico ${epic.name}`);
        return epic;
      });
    },
    createTask(input: TaskInput): Task | null {
      if (!guard("task.create")) return null;
      if (input.assigneeId && !assignAllowed(null, input.assigneeId)) {
        deny("atribuir tarefas a outras pessoas");
        return null;
      }
      const result = write((db) => {
        const p = projectFor(db, input.projectId);
        if (!input.title.trim()) throw new Error("Informe o título da tarefa.");
        validateTaskReferences(db, p, { ...input, teamId: input.teamId ?? p.teamIds[0] ?? null });
        const validRef = (collection: Array<{ id: string; projectId: string }>, id?: string | null) => {
          if (id && !collection.some((item) => item.id === id && item.projectId === p.id))
            throw new Error("Referência fora do projeto.");
        };
        validRef(db.epics, input.epicId);
        validRef(db.sprints, input.sprintId);
        validRef(db.tasks, input.parentId);
        const parent = db.tasks.find((t) => t.id === input.parentId);
        if (parent?.parentId) throw new Error("Subtarefas têm apenas um nível.");
        if (input.type === "subtask" && !parent) throw new Error("Selecione a tarefa principal.");
        if (input.sprintId && db.sprints.some((s) => s.id === input.sprintId && s.status === "done"))
          throw new Error("A sprint já foi encerrada.");
        const counter = (db.taskCounters[p.id] ?? 0) + 1;
        db.taskCounters[p.id] = counter;
        const task: Task = {
          id: uid("tsk"),
          ref: `${p.key}-${100 + counter}`,
          projectId: p.id,
          epicId: input.epicId ?? null,
          parentId: input.parentId ?? null,
          type: input.parentId ? "subtask" : (input.type ?? "task"),
          title: input.title.trim(),
          desc: input.desc ?? "",
          status: input.status ?? "todo",
          priority: input.priority ?? "medium",
          assigneeId: input.assigneeId ?? null,
          teamId: input.teamId ?? p.teamIds[0] ?? null,
          sprintId: input.sprintId ?? null,
          labels: input.labels ?? [],
          acceptance: input.acceptance ?? [],
          blockedBy: input.blockedBy ?? [],
          createdAt: now().toISOString(),
          updatedAt: now().toISOString(),
          dueDate: input.dueDate ?? null,
          doneAt: input.status === "done" ? now().toISOString() : null,
          createdBy: currentUser().id,
        };
        db.tasks.push(task);
        const { title, status, priority, assigneeId, dueDate, type } = task;
        audit(db, "create", "task", task.id, p.id, `criou a tarefa ${task.ref}`, null, {
          title,
          status,
          priority,
          assigneeId,
          dueDate,
          type,
        });
        if (task.assigneeId)
          queueNotifications(db, "task.assigned.v1", task.assigneeId, taskNotificationVars(db, task, p.name));
        return task;
      });
      if (result && !input.silent) notify("Tarefa criada", `${result.ref} — ${result.title}`, "ok");
      return result;
    },
    updateTask(id: string, fields: Partial<Task>) {
      const old = snapshot.db.tasks.find((t) => t.id === id);
      if (
        old &&
        fields.assigneeId !== undefined &&
        (fields.assigneeId ?? null) !== old.assigneeId &&
        !assignAllowed(old.assigneeId, fields.assigneeId ?? null)
      ) {
        deny("atribuir tarefas a outras pessoas");
        return;
      }
      if (!old || !canTouchTask(old)) {
        notify("Sem permissão", "Este perfil não pode editar a tarefa.", "err");
        return;
      }
      write((db) => {
        const task = taskFor(db, id);
        if (fields.title !== undefined && !fields.title.trim())
          throw new Error("Informe o título da tarefa.");
        const project = projectFor(db, task.projectId);
        validateTaskReferences(db, project, fields, id);
        if (fields.sprintId) {
          const s = db.sprints.find((s) => s.id === fields.sprintId && s.projectId === task.projectId);
          if (!s || s.status === "done") throw new Error("Sprint indisponível neste projeto.");
        }
        if (fields.epicId && !db.epics.some((e) => e.id === fields.epicId && e.projectId === task.projectId))
          throw new Error("Épico fora do projeto.");
        if (fields.blockedBy) {
          const reaches = (candidate: string, seen: Set<string>): boolean => {
            if (candidate === id) return true;
            if (seen.has(candidate)) return false;
            seen.add(candidate);
            const t = db.tasks.find((t) => t.id === candidate && t.projectId === task.projectId);
            if (!t) throw new Error("Dependência fora do projeto.");
            return t.blockedBy.some((next) => reaches(next, seen));
          };
          if (fields.blockedBy.some((dep) => reaches(dep, new Set())))
            throw new Error("Essa dependência criaria um ciclo.");
        }
        const before = structuredClone(task);
        const allowed = [
          "title",
          "desc",
          "status",
          "priority",
          "assigneeId",
          "teamId",
          "sprintId",
          "epicId",
          "labels",
          "acceptance",
          "blockedBy",
          "dueDate",
        ] as const;
        for (const field of allowed)
          if (fields[field] !== undefined) Object.assign(task, { [field]: fields[field] });
        task.updatedAt = now().toISOString();
        if (task.status !== before.status) task.doneAt = task.status === "done" ? task.updatedAt : null;
        const userName = (uid: string | null) => db.users.find((u) => u.id === uid)?.name;
        const changed = (key: keyof Task) => JSON.stringify(before[key]) !== JSON.stringify(task[key]);
        const added = task.blockedBy.filter((x) => !before.blockedBy.includes(x));
        const refOf = (tid: string | undefined) => db.tasks.find((x) => x.id === tid)?.ref ?? "?";
        const [action, summary] =
          task.status !== before.status
            ? [
                "status",
                `moveu ${task.ref} de ${STATUS_META[before.status].label} para ${STATUS_META[task.status].label}`,
              ]
            : changed("assigneeId")
              ? [
                  "assign",
                  task.assigneeId
                    ? `atribuiu ${task.ref} a ${userName(task.assigneeId) ?? "?"}`
                    : `removeu o responsável de ${task.ref}`,
                ]
              : added.length
                ? ["block", `marcou ${task.ref} como bloqueada por ${added.map(refOf).join(", ")}`]
                : task.blockedBy.length < before.blockedBy.length
                  ? ["unblock", `removeu um bloqueio de ${task.ref}`]
                  : changed("priority")
                    ? ["priority", `mudou a prioridade de ${task.ref} para ${PRIO_META[task.priority].label}`]
                    : ["update", `atualizou ${task.ref}`];
        audit(db, action, "task", id, task.projectId, summary, before, task);
        if (task.assigneeId && task.assigneeId !== before.assigneeId)
          queueNotifications(
            db,
            "task.assigned.v1",
            task.assigneeId,
            taskNotificationVars(db, task, project.name),
          );
        if (task.assigneeId && task.blockedBy.length > before.blockedBy.length) {
          const blocker = db.tasks.find((item) => item.id === task.blockedBy[0]);
          queueNotifications(db, "task.blocked.v1", task.assigneeId, {
            ref: task.ref,
            bloqueio: blocker?.ref ?? "?",
          });
        }
      });
    },
    moveTask(id: string, status: TaskStatus) {
      act.updateTask(id, { status });
    },
    deleteTask(id: string) {
      if (!guard("task.delete")) return;
      const removed = write((db) => {
        const t = taskFor(db, id);
        const ids = new Set([id, ...db.tasks.filter((x) => x.parentId === id).map((x) => x.id)]);
        db.tasks = db.tasks.filter((x) => !ids.has(x.id));
        db.comments = db.comments.filter((c) => !ids.has(c.taskId));
        for (const task of db.tasks) task.blockedBy = task.blockedBy.filter((x) => !ids.has(x));
        audit(db, "delete", "task", id, t.projectId, `excluiu a tarefa ${t.ref}`);
        return { ref: t.ref, subtasks: ids.size - 1 };
      });
      if (removed)
        notify(
          "Tarefa excluída",
          removed.subtasks
            ? `${removed.ref} e ${plural(removed.subtasks, "subtarefa", "subtarefas")}.`
            : removed.ref,
          "ok",
        );
    },
    addComment(taskId: string, text: string) {
      if (!guard("task.create", "comentar em tarefas")) return;
      write((db) => {
        const t = taskFor(db, taskId);
        if (!text.trim()) throw new Error("Escreva um comentário.");
        db.comments.push({
          id: uid("cm"),
          taskId,
          userId: currentUser().id,
          text: text.trim(),
          createdAt: now().toISOString(),
        });
        audit(db, "comment", "task", taskId, t.projectId, `comentou em ${t.ref}`);
      });
    },
    createSprint(projectId: string, input: SprintInput): Sprint | null {
      if (!guard("sprint.manage")) return null;
      return write((db) => {
        projectFor(db, projectId);
        if (!input.name.trim()) throw new Error("Informe o nome da sprint.");
        validateDates(input.startDate, input.endDate);
        if (!input.startDate || !input.endDate || input.startDate === input.endDate)
          throw new Error("Defina um período válido.");
        const sprint: Sprint = {
          id: uid("sp"),
          projectId,
          name: input.name.trim(),
          goal: input.goal ?? "",
          startDate: input.startDate,
          endDate: input.endDate,
          status: "planned",
        };
        db.sprints.push(sprint);
        audit(db, "create", "sprint", sprint.id, projectId, `criou a ${sprint.name}`);
        return sprint;
      });
    },
    startSprint(id: string) {
      if (!guard("sprint.manage")) return;
      const started = write((db) => {
        const s = db.sprints.find((s) => s.id === id);
        if (s?.status !== "planned") throw new Error("Somente sprints planejadas podem iniciar.");
        const project = projectFor(db, s.projectId);
        if (db.sprints.some((other) => other.projectId === s.projectId && other.status === "active"))
          throw new Error("Já existe uma sprint ativa neste projeto.");
        s.status = "active";
        audit(db, "sprint_start", "sprint", id, s.projectId, `iniciou a ${s.name}`);
        queueNotifications(db, "sprint.started.v1", project.leadId, {
          sprint: s.name,
          projeto: project.name,
          meta: s.goal,
        });
        return s.name;
      });
      if (started) notify("Sprint iniciada", `${started} está ativa.`, "ok");
    },
    completeSprint(id: string) {
      if (!guard("sprint.manage")) return;
      const ended = write((db) => {
        const s = db.sprints.find((s) => s.id === id);
        if (s?.status !== "active") throw new Error("Somente sprints ativas podem encerrar.");
        const project = projectFor(db, s.projectId);
        s.status = "done";
        const unfinished = db.tasks.filter(
          (t) => t.sprintId === id && t.status !== "done" && !t.parentId,
        ).length;
        for (const t of db.tasks.filter((t) => t.sprintId === id && t.status !== "done")) {
          t.sprintId = null;
          t.status = "backlog";
          t.updatedAt = now().toISOString();
        }
        const finished = db.tasks.filter((t) => t.sprintId === id && t.status === "done").length;
        audit(db, "sprint_end", "sprint", id, s.projectId, `encerrou a ${s.name}`);
        queueNotifications(db, "sprint.completed.v1", project.leadId, {
          sprint: s.name,
          feitas: String(finished),
          concluidas: plural(finished, "tarefa concluída", "tarefas concluídas"),
        });
        return { name: s.name, unfinished };
      });
      if (ended)
        notify(
          "Sprint encerrada",
          ended.unfinished
            ? `${ended.name}: ${plural(ended.unfinished, "tarefa voltou", "tarefas voltaram")} ao backlog.`
            : `${ended.name}: todas as tarefas foram concluídas.`,
          "ok",
        );
    },
    createMilestone(projectId: string, input: { name: string; date: string }): Milestone | null {
      if (!guard("project.edit")) return null;
      return write((db) => {
        projectFor(db, projectId);
        if (!input.name.trim() || !input.date) throw new Error("Informe nome e data do marco.");
        const milestone: Milestone = {
          id: uid("ms"),
          projectId,
          name: input.name.trim(),
          date: input.date,
          status: "open",
        };
        db.milestones.push(milestone);
        audit(db, "create", "milestone", milestone.id, projectId, `criou o marco ${milestone.name}`);
        return milestone;
      });
    },
    updateMilestone(id: string, fields: Partial<Milestone>) {
      if (!guard("project.edit")) return;
      write((db) => {
        const m = db.milestones.find((m) => m.id === id);
        if (!m) throw new Error("Marco não encontrado.");
        projectFor(db, m.projectId);
        if (fields.name !== undefined) m.name = fields.name;
        if (fields.date !== undefined) m.date = fields.date;
        if (fields.status !== undefined) m.status = fields.status;
        audit(db, "update", "milestone", id, m.projectId, `atualizou o marco ${m.name}`);
      });
    },
    setNotifPref(eventType: string, channel: NotificationChannel, enabled: boolean) {
      if (!guard("notif.manage")) return;
      write((db) => {
        const preference = db.notificationPreferences[eventType];
        if (!preference) throw new Error("Evento de notificação desconhecido.");
        preference[channel] = enabled;
        audit(
          db,
          "update",
          "notification",
          eventType,
          null,
          `${enabled ? "ligou" : "desligou"} "${
            db.notificationTemplates.find((t) => t.event === eventType)?.name ?? eventType
          }" por ${CHANNEL_LABEL[channel]}`,
          { enabled: !enabled },
          { enabled },
        );
      });
    },
    resendNotification(id: string) {
      if (!guard("notif.manage")) return;
      const delivered = write((db) => {
        const notification = db.notifications.find((item) => item.id === id);
        if (!notification) throw new Error("Notificação não encontrada.");
        if (notification.status !== "failed")
          throw new Error("Somente notificações com falha podem ser reenviadas.");
        const provider = db.notificationProviders[notification.channel];
        notification.attempts += 1;
        if (provider.configured) {
          notification.status = "delivered";
          notification.failReason = null;
          notification.ts = now().toISOString();
        } else {
          notification.failReason = `Provedor de ${
            notification.channel === "whatsapp" ? "WhatsApp" : notification.channel.toUpperCase()
          } não configurado`;
        }
        audit(
          db,
          "retry",
          "notification",
          id,
          null,
          `reenviou o ${CHANNEL_LABEL[notification.channel]} para ${
            db.users.find((u) => u.id === notification.toUserId)?.name ?? "?"
          }`,
        );
        return provider.configured;
      });
      if (delivered === true) notify("Notificação reenviada", "O provedor confirmou a entrega.", "ok");
      else if (delivered === false)
        notify("Reenvio falhou", "O provedor deste canal segue não configurado.", "err");
    },
    setProvider(
      channel: NotificationChannel,
      fields: Pick<NotificationProvider, "from" | "host" | "configured">,
    ) {
      if (!guard("notif.manage")) return;
      const saved = write((db) => {
        const provider = db.notificationProviders[channel];
        if (!fields.from.trim()) throw new Error("Informe o remetente.");
        Object.assign(provider, {
          from: fields.from.trim(),
          host: fields.host.trim(),
          configured: fields.configured,
        });
        audit(
          db,
          "update",
          "notification",
          channel,
          null,
          `configurou o provedor de ${CHANNEL_LABEL[channel]}`,
        );
      });
      if (saved === null) return;
      notify(
        "Provedor atualizado",
        channel === "email" ? "E-mail" : channel === "whatsapp" ? "WhatsApp" : "SMS",
        "ok",
      );
    },
    setUserRole(id: string, roleId: RoleId) {
      if (!guard("user.manage")) return;
      const saved = write((db) => {
        const user = db.users.find((item) => item.id === id);
        if (!user) throw new Error("Usuário não encontrado.");
        if (user.id === db.settings.currentUserId) throw new Error("Não é possível alterar o próprio papel.");
        const before = user.roleId;
        user.roleId = roleId;
        audit(
          db,
          "update",
          "user",
          id,
          null,
          `alterou o papel de ${user.name} para ${ROLE_LABEL[roleId]}`,
          { role: ROLE_LABEL[before] },
          { role: ROLE_LABEL[roleId] },
        );
      });
      if (saved !== null)
        notify("Papel atualizado", "As capacidades do colaborador foram recalculadas.", "ok");
    },
    inviteUser(input: {
      name: string;
      email: string;
      title: string;
      roleId: RoleId;
      teamIds: string[];
    }): User | null {
      if (!guard("user.manage")) return null;
      const created = write((db) => {
        const name = input.name.trim();
        const email = input.email.trim().toLowerCase();
        if (name.split(" ").filter(Boolean).length < 2) throw new Error("Informe nome e sobrenome.");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido.");
        if (db.users.some((user) => user.email.toLowerCase() === email))
          throw new Error("Já existe um colaborador com este e-mail.");
        if (input.teamIds.some((teamId) => !db.teams.some((team) => team.id === teamId)))
          throw new Error("Equipe inválida.");
        const user: User = {
          id: uid("u"),
          name,
          email,
          initials: name
            .split(" ")
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join(""),
          color: "#5B6472",
          title: input.title.trim(),
          roleId: input.roleId,
          orgId: currentUser().orgId,
          teamIds: input.teamIds,
          active: true,
          invited: true,
          favoriteProjectIds: [],
        };
        db.users.push(user);
        for (const team of db.teams)
          if (input.teamIds.includes(team.id) && !team.memberIds.includes(user.id))
            team.memberIds.push(user.id);
        audit(db, "create", "user", user.id, null, `convidou ${user.name} como ${ROLE_LABEL[user.roleId]}`);
        return user;
      });
      if (created)
        notify("Convite registrado", `${created.name} receberá acesso quando confirmar o convite.`, "ok");
      return created;
    },
  };
  if (recovery)
    notify(
      "Dados recuperados",
      "Os dados locais estavam incompatíveis. O cenário inicial foi recuperado.",
      "warn",
    );
  return { getSnapshot, subscribe, act, can, canTouchTask, visibleProjects, currentUser, notify };
}

let browserStorage: StoragePort | undefined;
try {
  browserStorage = globalThis.localStorage;
} catch {
  /* Browser can disable persistent storage. */
}
export const workspaceStore = createWorkspaceStore({ storage: browserStorage });
export function useWorkspace() {
  const snapshot = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  // Derived collections keep a stable identity between renders. Without this,
  // consumers such as the Insights remote would see a new array on every
  // render and restart their effects (which cancelled the first remote mount).
  const visibleProjects = useMemo(() => workspaceStore.visibleProjects(snapshot.db), [snapshot.db]);
  const accessibleProjects = useMemo(() => workspaceStore.visibleProjects(snapshot.db, true), [snapshot.db]);
  const projectIds = useMemo(() => new Set(visibleProjects.map((p) => p.id)), [visibleProjects]);
  const visibleTasks = useMemo(
    () => snapshot.db.tasks.filter((t) => projectIds.has(t.projectId)),
    [snapshot.db.tasks, projectIds],
  );
  const me = useMemo(() => workspaceStore.currentUser(snapshot.db), [snapshot.db]);
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
    can: workspaceStore.can,
    canTouchTask: workspaceStore.canTouchTask,
    act: workspaceStore.act,
    notify: workspaceStore.notify,
  };
}
