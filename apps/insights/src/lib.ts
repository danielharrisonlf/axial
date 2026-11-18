import type { InsightPriority, InsightProject, InsightStatus, InsightTask } from "./types";

export const DAY = 86_400_000;
export const STATUSES: InsightStatus[] = ["backlog", "todo", "in_progress", "in_review", "done"];
/** Status colors are design tokens (DESIGN.md §10), always shown with glyph and label. */
export const STATUS_META: Record<InsightStatus, { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "var(--ink-3)" },
  todo: { label: "A fazer", color: "var(--ink-2)" },
  in_progress: { label: "Em andamento", color: "var(--accent)" },
  in_review: { label: "Em revisão", color: "var(--violet)" },
  done: { label: "Concluído", color: "var(--ok)" },
};
export const PRIO_LABEL: Record<InsightPriority, string> = {
  urgent: "Urgente",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};
export const LABEL_NAME: Record<string, string> = {
  backend: "Backend",
  frontend: "Frontend",
  mobile: "Mobile",
  infra: "Infraestrutura",
  dados: "Dados",
  ux: "UX",
  seguranca: "Segurança",
  performance: "Performance",
  documentacao: "Documentação",
  cliente: "Cliente",
};
export const SOURCE_LABEL: Record<string, string> = {
  ui: "Interface",
  ai: "IA",
  mcp: "Agente MCP",
  automation: "Automação",
  api: "API",
};
export const sourceLabel = (source: string): string => SOURCE_LABEL[source] ?? source;
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "AAAA-MM-DD" values are local calendar days, never UTC instants. */
export function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.length === 10 && !isDateOnly(value)) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getDate()} ${months[date.getMonth()]}${
    date.getFullYear() !== new Date().getFullYear() ? ` ${date.getFullYear()}` : ""
  }`;
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${fmtDate(value)}, ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
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

/** Days until a due date in local calendar days: 0 = today, -1 = due yesterday (overdue). */
export function daysLeft(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!isDateOnly(day)) return null;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / DAY);
}

export function isOverdue(task: InsightTask): boolean {
  return task.status !== "done" && (daysLeft(task.dueDate) ?? 0) < 0;
}

/** Local calendar day on which the task was completed (from doneAt, never updatedAt). */
export function doneDay(task: InsightTask): string | null {
  if (task.status !== "done" || !task.doneAt) return null;
  const date = new Date(task.doneAt);
  return Number.isNaN(date.getTime()) ? null : ymd(date);
}

/** Blockers that still hold the task: they exist in scope and are not done. */
export function activeBlockers(task: InsightTask, byId: Map<string, InsightTask>): InsightTask[] {
  return task.blockedBy
    .map((id) => byId.get(id))
    .filter((blocker): blocker is InsightTask => !!blocker && blocker.status !== "done");
}

export function isBlocked(task: InsightTask, byId: Map<string, InsightTask>): boolean {
  return task.status !== "done" && activeBlockers(task, byId).length > 0;
}

export function projectProgress(tasks: InsightTask[], projectId: string): number {
  const scoped = tasks.filter((task) => task.projectId === projectId && !task.parentId);
  return scoped.length
    ? Math.round((100 * scoped.filter((task) => task.status === "done").length) / scoped.length)
    : 0;
}

export type Risk = { level: "high" | "mid" | "ok"; label: string };

/** Project risk over all of its top-level tasks (filters do not change a project's situation). */
export function projectRisk(
  tasks: InsightTask[],
  project: InsightProject,
  byId: Map<string, InsightTask>,
): Risk {
  const scoped = tasks.filter((task) => task.projectId === project.id && !task.parentId);
  const late = scoped.filter(isOverdue).length;
  const blocked = scoped.filter((task) => isBlocked(task, byId)).length;
  const target = project.targetDate ? daysLeft(project.targetDate) : 99;
  const progress = projectProgress(tasks, project.id);
  if (project.status === "done") return { level: "ok", label: "Entregue" };
  if (late >= 3 || (target != null && target < 15 && progress < 60) || blocked >= 2)
    return { level: "high", label: "Em risco" };
  if (late >= 1 || (target != null && target < 30 && progress < 50))
    return { level: "mid", label: "Atenção" };
  return { level: "ok", label: "Saudável" };
}

/** Share of completed tasks with a due date that were completed on or before it. */
export function onTimeRate(tasks: InsightTask[]): number | null {
  const withDue = tasks.filter((task) => task.status === "done" && task.dueDate);
  if (!withDue.length) return null;
  const ok = withDue.filter((task) => {
    const day = doneDay(task);
    return !!day && day <= (task.dueDate as string).slice(0, 10);
  }).length;
  return Math.round((100 * ok) / withDue.length);
}

export function doneAtTime(task: InsightTask): number {
  return task.status === "done" && task.doneAt ? new Date(task.doneAt).getTime() : Number.NaN;
}

/** Completed tasks per week (oldest first); 6 to 13 weeks depending on the period. */
export function weeklyCompletions(tasks: InsightTask[], period: number, now = Date.now()) {
  const weeks = Math.min(13, Math.max(6, Math.round(period / 7)));
  const rows: { label: string; y: number }[] = [];
  for (let index = weeks - 1; index >= 0; index--) {
    const start = now - (index + 1) * 7 * DAY;
    const end = now - index * 7 * DAY;
    rows.push({
      label: fmtDate(new Date(end).toISOString()),
      y: tasks.filter((task) => {
        const ts = doneAtTime(task);
        return ts >= start && ts < end;
      }).length,
    });
  }
  return rows;
}

/** Data keeps a light-palette hex; the interface uses the themed categorical token. */
const CAT_HEX = [
  "#2B5FD9",
  "#6D4FC4",
  "#0E7490",
  "#1D7A4C",
  "#9A5B00",
  "#BE3030",
  "#B23A78",
  "#4A6572",
  "#7A5C2E",
  "#3D7068",
];
export function catVar(hex: string | null | undefined): string {
  const key = String(hex ?? "").toUpperCase();
  let index = CAT_HEX.indexOf(key);
  if (index < 0) {
    let n = 0;
    for (let k = 0; k < key.length; k++) n = (n * 31 + key.charCodeAt(k)) >>> 0;
    index = n % CAT_HEX.length;
  }
  return `var(--cat-${index + 1})`;
}

/** Stable descending comparator on a number; ties keep the incoming order. */
export const byValueDesc = <T extends { value: number }>(a: T, b: T): number => b.value - a.value;
