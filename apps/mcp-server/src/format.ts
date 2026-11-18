import type { Project, Sprint, Task } from "./schemas.js";

export const STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "A fazer",
  in_progress: "Em andamento",
  in_review: "Em revisão",
  done: "Concluído",
};

export function day(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}

/** Short, stable id for people: the services only hold user ids, names live in ms-identity. */
export function person(userId: string | null | undefined): string {
  return userId ? `@${userId.slice(0, 8)}` : "sem responsável";
}

export function isOverdue(task: Task, now = Date.now()): boolean {
  return task.status !== "done" && task.dueDate !== null && new Date(task.dueDate).getTime() < now;
}

/** Blockers of a task that are not done yet, resolved against the tasks we know. */
export function openBlockers(task: Task, byId: Map<string, Task>): string[] {
  return (task.dependencies ?? [])
    .map((dependency) => byId.get(dependency.dependsOnId))
    .filter((blocker): blocker is Task => blocker !== undefined && blocker.status !== "done")
    .map((blocker) => blocker.ref);
}

export function taskLine(task: Task, byId?: Map<string, Task>): string {
  const parts = [
    `${task.ref} · ${task.title}`,
    task.type === "task" ? undefined : task.type,
    STATUS_LABEL[task.status] ?? task.status,
    task.priority,
    person(task.assigneeId),
    task.estimate === null ? undefined : `${task.estimate} pts`,
    task.dueDate ? `prazo ${day(task.dueDate)}${isOverdue(task) ? " (ATRASADA)" : ""}` : undefined,
  ];
  const blockers = byId ? openBlockers(task, byId) : [];
  if (blockers.length) parts.push(`bloqueada por ${blockers.join(", ")}`);
  return `- ${parts.filter(Boolean).join(" · ")}`;
}

export function taskList(tasks: Task[], byId?: Map<string, Task>, empty = "- (nenhuma)"): string {
  return tasks.length ? tasks.map((task) => taskLine(task, byId)).join("\n") : empty;
}

export function projectHeader(project: Project): string {
  return `${project.key} — ${project.name} (status ${project.status}, prioridade ${project.priority}, ${day(project.startDate)} → ${day(project.endDate)}${project.archivedAt ? ", ARQUIVADO" : ""})`;
}

export function sprintLine(sprint: Sprint): string {
  return `- ${sprint.name} [${sprint.status}] ${day(sprint.startDate)} → ${day(sprint.endDate)}${sprint.goal ? ` — meta: ${sprint.goal}` : ""} (id ${sprint.id}, versão ${sprint.version})`;
}

interface BoardColumn {
  status: string;
  items: Task[];
  total: number;
}

/** The Kanban board as Markdown: one section per column, blocked and overdue tasks flagged. */
export function boardMarkdown(project: Project, columns: BoardColumn[]): string {
  const byId = new Map(columns.flatMap((column) => column.items).map((task) => [task.id, task]));
  const lines = [`# Quadro ${project.key} — ${project.name}`, ""];
  for (const column of columns) {
    lines.push(`## ${STATUS_LABEL[column.status] ?? column.status} (${column.total})`, "");
    lines.push(taskList(column.items, byId, "_vazio_"));
    if (column.total > column.items.length)
      lines.push(
        `- … e mais ${column.total - column.items.length} (use list-tasks com status=${column.status})`,
      );
    lines.push("");
  }
  return lines.join("\n");
}
