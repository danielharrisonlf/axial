import { useSyncExternalStore } from "react";
import { STATUS_META } from "../lib/format";
import { workspaceDataSchema } from "./schema";
import { createDemoData } from "./seed";
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
    "notif.view",
    "notif.manage",
    "audit.view",
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
  viewer: ["project.view", "task.view", "sprint.view", "team.view", "notif.view", "audit.view"],
};
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
        if (parsed.success && parsed.data.users.some((u) => u.id === parsed.data.settings.currentUserId))
          initial = parsed.data as WorkspaceData;
        else recovery = true;
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
          me.roleId === "viewer" ||
          (p.orgId === me.orgId &&
            (me.roleId === "pm" || p.leadId === me.id || p.teamIds.some((t) => me.teamIds.includes(t))))),
    );
  };
  const canSee = (projectId: string) => visibleProjects().some((p) => p.id === projectId);
  const canTouchTask = (task: Task) => {
    const me = currentUser();
    if (!can("task.edit") || !canSee(task.projectId)) return false;
    if (me.roleId === "admin" || me.roleId === "pm") return true;
    if (me.roleId === "lead")
      return (task.teamId !== null && me.teamIds.includes(task.teamId)) || task.assigneeId === me.id;
    return task.assigneeId === me.id || task.createdBy === me.id || !task.assigneeId;
  };
  const notify = (title: string, message = "", tone: ToastTone = "info") => {
    const toast: Toast = { id: uid("toast"), title, message, tone };
    snapshot = { ...snapshot, toasts: [...snapshot.toasts.slice(-3), toast] };
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
      source: "ui",
    };
    db.audit.unshift(entry);
  };
  const guard = (cap: string) => {
    if (can(cap)) return true;
    notify("Sem permissão", "O perfil atual não pode realizar esta ação.", "err");
    return false;
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
    setTheme(theme: Theme) {
      write((db) => {
        db.settings.theme = theme;
      });
    },
    setUser(id: string) {
      write((db) => {
        if (!db.users.some((u) => u.id === id && u.active)) throw new Error("Perfil indisponível");
        db.settings.currentUserId = id;
      });
    },
    setCurrentProject(id: string) {
      write((db) => {
        if (!canSee(id)) throw new Error("Projeto não disponível");
        db.settings.currentProjectId = id;
      });
    },
    resetDemo() {
      commit(createDemoData(now()));
      notify("Dados de demonstração restaurados", "Todo o estado voltou ao cenário inicial.", "ok");
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
          startDate: input.startDate || now().toISOString().slice(0, 10),
          targetDate: input.targetDate || null,
          favorite: false,
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
      write((db) => {
        const project = projectFor(db, id);
        validateProjectReferences(db, project.orgId, fields);
        validateDates(
          fields.startDate ?? project.startDate,
          fields.targetDate === undefined ? project.targetDate : fields.targetDate,
        );
        if (fields.name !== undefined && !fields.name.trim()) throw new Error("Informe o nome do projeto.");
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
      });
    },
    archiveProject(id: string) {
      if (!guard("project.archive")) return;
      write((db) => {
        const p = projectFor(db, id);
        p.archived = true;
        audit(db, "archive", "project", id, id, `arquivou o projeto ${p.name}`);
      });
    },
    restoreProject(id: string) {
      if (!guard("project.archive")) return;
      write((db) => {
        const p = visibleProjects(db, true).find((p) => p.id === id);
        if (!p) throw new Error("Projeto não encontrado.");
        p.archived = false;
        audit(db, "restore", "project", id, id, `restaurou o projeto ${p.name}`);
      });
    },
    toggleFavorite(id: string) {
      write((db) => {
        const p = db.projects.find((p) => p.id === id);
        if (!p || !canSee(id)) throw new Error("Projeto não disponível");
        p.favorite = !p.favorite;
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
          createdBy: currentUser().id,
        };
        db.tasks.push(task);
        audit(db, "create", "task", task.id, p.id, `criou a tarefa ${task.ref}`, null, task);
        if (task.assigneeId)
          queueNotifications(db, "task.assigned.v1", task.assigneeId, taskNotificationVars(db, task, p.name));
        return task;
      });
      if (result && !input.silent) notify("Tarefa criada", `${result.ref} — ${result.title}`, "ok");
      return result;
    },
    updateTask(id: string, fields: Partial<Task>) {
      const old = snapshot.db.tasks.find((t) => t.id === id);
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
        const summary =
          fields.status && fields.status !== before.status
            ? `moveu ${task.ref} de ${STATUS_META[before.status].label} para ${STATUS_META[task.status].label}`
            : `atualizou ${task.ref}`;
        audit(db, fields.status ? "status" : "update", "task", id, task.projectId, summary, before, task);
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
      write((db) => {
        const t = taskFor(db, id);
        const ids = new Set([id, ...db.tasks.filter((x) => x.parentId === id).map((x) => x.id)]);
        db.tasks = db.tasks.filter((x) => !ids.has(x.id));
        db.comments = db.comments.filter((c) => !ids.has(c.taskId));
        for (const task of db.tasks) task.blockedBy = task.blockedBy.filter((x) => !ids.has(x));
        audit(db, "delete", "task", id, t.projectId, `excluiu a tarefa ${t.ref}`);
      });
    },
    addComment(taskId: string, text: string) {
      if (!guard("task.create")) return;
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
      write((db) => {
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
      });
    },
    completeSprint(id: string) {
      if (!guard("sprint.manage")) return;
      write((db) => {
        const s = db.sprints.find((s) => s.id === id);
        if (s?.status !== "active") throw new Error("Somente sprints ativas podem encerrar.");
        const project = projectFor(db, s.projectId);
        s.status = "done";
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
        });
      });
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
          `alterou a preferência ${eventType} / ${channel} para ${enabled ? "ligada" : "desligada"}`,
          { channel, enabled: !enabled },
          { channel, enabled },
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
          `reenviou a notificação ${notification.channel} de ${notification.toUserId}`,
        );
        return provider.configured;
      });
      if (delivered === true) notify("Notificação reenviada", "Entrega concluída na demonstração.", "ok");
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
        audit(db, "update", "notification", channel, null, `configurou o provedor de ${channel}`);
      });
      if (saved === null) return;
      notify(
        "Provedor atualizado",
        channel === "email" ? "E-mail" : channel === "whatsapp" ? "WhatsApp" : "SMS",
        "ok",
      );
    },
  };
  if (recovery)
    notify(
      "Demonstração restaurada",
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
  const visibleProjects = workspaceStore.visibleProjects(snapshot.db);
  const projectIds = new Set(visibleProjects.map((p) => p.id));
  return {
    ...snapshot,
    me: workspaceStore.currentUser(snapshot.db),
    visibleProjects,
    accessibleProjects: workspaceStore.visibleProjects(snapshot.db, true),
    visibleTasks: snapshot.db.tasks.filter((t) => projectIds.has(t.projectId)),
    can: workspaceStore.can,
    canTouchTask: workspaceStore.canTouchTask,
    act: workspaceStore.act,
    notify: workspaceStore.notify,
  };
}
