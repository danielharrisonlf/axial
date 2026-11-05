import type { Priority, Project, Task, TaskStatus, WorkspaceData } from "../data/types";

export const STATUSES: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "done"];
export const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];
export const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "var(--ink-3)" },
  todo: { label: "A fazer", color: "var(--ink-2)" },
  in_progress: { label: "Em andamento", color: "var(--accent)" },
  in_review: { label: "Em revisão", color: "var(--violet)" },
  done: { label: "Concluído", color: "var(--ok)" },
};
export const PRIO_META: Record<Priority, { label: string; color: string; icon: string }> = {
  urgent: { label: "Urgente", color: "var(--danger)", icon: "prio-urgent" },
  high: { label: "Alta", color: "var(--warn)", icon: "prio-high" },
  medium: { label: "Média", color: "var(--info)", icon: "prio-medium" },
  low: { label: "Baixa", color: "var(--ink-3)", icon: "prio-low" },
};
export const LABELS = [
  "backend",
  "frontend",
  "mobile",
  "infra",
  "dados",
  "ux",
  "seguranca",
  "performance",
  "documentacao",
  "cliente",
];
const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${months[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return `${fmtDate(value)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function rel(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `há ${days} d` : fmtDate(value);
}
export function daysLeft(value: string | null | undefined): number | null {
  if (!value) return null;
  return Math.ceil((new Date(`${value.slice(0, 10)}T23:59:59`).getTime() - Date.now()) / 86400000);
}
export function isOverdue(task: Task): boolean {
  return task.status !== "done" && (daysLeft(task.dueDate) ?? 0) < 0;
}
export function projectProgress(db: WorkspaceData, projectId: string): number {
  const tasks = db.tasks.filter((task) => task.projectId === projectId && !task.parentId);
  return tasks.length
    ? Math.round((100 * tasks.filter((task) => task.status === "done").length) / tasks.length)
    : 0;
}
export function projectRisk(
  db: WorkspaceData,
  project: Project,
): { level: "high" | "mid" | "ok"; label: string; late?: number; blocked?: number } {
  const tasks = db.tasks.filter((task) => task.projectId === project.id && !task.parentId);
  const late = tasks.filter(isOverdue).length;
  const blocked = tasks.filter((task) => task.blockedBy.length && task.status !== "done").length;
  const target = daysLeft(project.targetDate) ?? 99;
  const progress = projectProgress(db, project.id);
  if (project.status === "done") return { level: "ok", label: "Entregue" };
  if (late >= 3 || (target < 15 && progress < 60) || blocked >= 2)
    return { level: "high", label: "Em risco", late, blocked };
  if (late >= 1 || (target < 30 && progress < 50)) return { level: "mid", label: "Atenção", late, blocked };
  return { level: "ok", label: "Saudável", late, blocked };
}
export function navigate(path: string): void {
  window.location.hash = path.startsWith("#") ? path : `#${path.startsWith("/") ? path : `/${path}`}`;
}
