import type { InsightProject, InsightTask } from "./types";

export const DAY = 86_400_000;
export const STATUSES = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
export const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
  backlog: "Backlog",
  todo: "A fazer",
  in_progress: "Em andamento",
  in_review: "Em revisão",
  done: "Concluído",
};
export const STATUS_COLOR: Record<(typeof STATUSES)[number], string> = {
  backlog: "#8b93a1",
  todo: "#5b6472",
  in_progress: "#2b5fd9",
  in_review: "#6d4fc4",
  done: "#1d7a4c",
};
const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getDate()} ${months[date.getMonth()]}${
    date.getFullYear() !== new Date().getFullYear() ? ` ${date.getFullYear()}` : ""
  }`;
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return `${fmtDate(value)}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(
    2,
    "0",
  )}`;
}

export function rel(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `há ${days} d` : fmtDate(value);
}

export function daysLeft(value: string | null | undefined): number | null {
  if (!value) return null;
  return Math.ceil((new Date(`${value.slice(0, 10)}T23:59:59`).getTime() - Date.now()) / DAY);
}

export function isOverdue(task: InsightTask): boolean {
  return task.status !== "done" && (daysLeft(task.dueDate) ?? 0) < 0;
}

export function projectProgress(tasks: InsightTask[], projectId: string): number {
  const scoped = tasks.filter((task) => task.projectId === projectId && !task.parentId);
  return scoped.length
    ? Math.round((100 * scoped.filter((task) => task.status === "done").length) / scoped.length)
    : 0;
}

export function projectRisk(
  tasks: InsightTask[],
  project: InsightProject,
): { level: "high" | "mid" | "ok"; label: string } {
  const scoped = tasks.filter((task) => task.projectId === project.id && !task.parentId);
  const late = scoped.filter(isOverdue).length;
  const blocked = scoped.filter((task) => task.blockedBy.length && task.status !== "done").length;
  const target = daysLeft(project.targetDate) ?? 99;
  const progress = projectProgress(tasks, project.id);
  if (project.status === "done") return { level: "ok", label: "Entregue" };
  if (late >= 3 || (target < 15 && progress < 60) || blocked >= 2)
    return { level: "high", label: "Em risco" };
  if (late >= 1 || (target < 30 && progress < 50)) return { level: "mid", label: "Atenção" };
  return { level: "ok", label: "Saudável" };
}

export function onTimeRate(tasks: InsightTask[]): number | null {
  const withDue = tasks.filter((task) => task.status === "done" && task.dueDate);
  if (!withDue.length) return null;
  const ok = withDue.filter(
    (task) => task.updatedAt.slice(0, 10) <= (task.dueDate as string).slice(0, 10),
  ).length;
  return Math.round((100 * ok) / withDue.length);
}

/** Points for the delivery line chart: completed tasks per week. */
export function weeklyCompletions(tasks: InsightTask[], period: number) {
  const weeks = Math.min(13, Math.max(6, Math.round(period / 7)));
  const rows: { label: string; value: number }[] = [];
  for (let index = weeks - 1; index >= 0; index--) {
    const start = Date.now() - (index + 1) * 7 * DAY;
    const end = Date.now() - index * 7 * DAY;
    rows.push({
      label: fmtDate(new Date(end).toISOString()),
      value: tasks.filter((task) => {
        const updated = new Date(task.updatedAt).getTime();
        return task.status === "done" && updated >= start && updated < end;
      }).length,
    });
  }
  return rows;
}
