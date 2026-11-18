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
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "AAAA-MM-DD" values are local calendar days, never UTC instants. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** Today (plus an optional offset in days) as a local calendar day. */
export function todayLocal(offsetDays = 0, now = new Date()): string {
  const d = new Date(now);
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  return ymd(d);
}
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
export function fmtDate(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "—";
  if (value.length === 10 && !isDateOnly(value)) return "—";
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${months[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${fmtDate(value)}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
/**
 * Days until a due date: 0 = today, 1 = tomorrow, -1 = due yesterday (overdue).
 * Compares local calendar days; the previous version rounded a "23:59:59" instant up and
 * reported yesterday as 0 (not late) and today as 1 (audit CODE-01).
 */
export function daysLeft(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!isDateOnly(day)) return null;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000);
}
export function isOverdue(task: Task): boolean {
  return task.status !== "done" && (daysLeft(task.dueDate) ?? 0) < 0;
}
/** Short due text used on cards and rows: "2d de atraso", "Hoje", "Amanhã" or the date. */
export function dueText(task: Task, lateForm = false): string {
  const d = daysLeft(task.dueDate);
  if (d == null) return "—";
  if (lateForm && task.status !== "done" && d < 0) return `${-d}d de atraso`;
  return d === 0 ? "Hoje" : d === 1 ? "Amanhã" : fmtDate(task.dueDate);
}
/** Tone of a due date: late (past and open), soon (up to 2 days) or neutral. */
export function dueTone(task: Task): "late" | "soon" | "" {
  const d = daysLeft(task.dueDate);
  if (d == null || task.status === "done") return "";
  return d < 0 ? "late" : d <= 2 ? "soon" : "";
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
  let i = CAT_HEX.indexOf(key);
  if (i < 0) {
    let n = 0;
    for (let k = 0; k < key.length; k++) n = (n * 31 + key.charCodeAt(k)) >>> 0;
    i = n % CAT_HEX.length;
  }
  return `var(--cat-${i + 1})`;
}
/** The key stays in the data; the interface shows the accented, capitalized name. */
export const LABEL_META: Record<string, { name: string; cat: number }> = {
  backend: { name: "Backend", cat: 1 },
  frontend: { name: "Frontend", cat: 7 },
  mobile: { name: "Mobile", cat: 2 },
  infra: { name: "Infraestrutura", cat: 3 },
  dados: { name: "Dados", cat: 5 },
  ux: { name: "UX", cat: 10 },
  seguranca: { name: "Segurança", cat: 6 },
  performance: { name: "Performance", cat: 9 },
  documentacao: { name: "Documentação", cat: 8 },
  cliente: { name: "Cliente", cat: 4 },
};
export const labelName = (key: string): string => LABEL_META[key]?.name ?? key;
/** Audit origin, with a single wording across the interface. */
export const SOURCE_META: Record<string, string> = {
  ui: "Interface",
  ai: "IA",
  mcp: "Agente MCP",
  automation: "Automação",
  api: "API",
};
export const sourceLabel = (source: string): string => SOURCE_META[source] ?? source;
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
export const TYPE_META: Record<Task["type"] | "epic", { label: string; icon: string; color: string }> = {
  task: { label: "Tarefa", icon: "tasks", color: "var(--accent)" },
  bug: { label: "Bug", icon: "bug", color: "var(--danger)" },
  subtask: { label: "Subtarefa", icon: "subtask", color: "var(--ink-2)" },
  epic: { label: "Épico", icon: "epic", color: "var(--violet)" },
};
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
  // blocked = open task with at least one blocker still open (same rule as Insights and the prototype)
  const blocked = tasks.filter(
    (task) =>
      task.status !== "done" &&
      task.blockedBy.some((id) => db.tasks.some((other) => other.id === id && other.status !== "done")),
  ).length;
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
/** Role names shown in the interface (the backend calls them ADMIN, PROJECT_MANAGER, TEAM_LEAD, CONTRIBUTOR, VIEWER). */
export const ROLE_LABEL: Record<"admin" | "pm" | "lead" | "dev" | "viewer", string> = {
  admin: "Administrador da organização",
  pm: "Gestor de projetos",
  lead: "Líder de equipe",
  dev: "Desenvolvedor",
  viewer: "Visualizador",
};
