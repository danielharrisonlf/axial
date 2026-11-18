import { ROLE_LABEL } from "../lib/format";
import original from "./demo-seed.json";
import type { Notification, NotificationChannel, Task, WorkspaceData } from "./types";

/** Seed generation. Version 9 ports the prototype's seed 8: lean notification history,
 * real completion dates and favorites per person. Older saved states are migrated by
 * {@link migrateToCurrent}; the storage key stays `axial.workspace.demo.v1`. */
export const SEED_VERSION = 9;

type LegacyProject = WorkspaceData["projects"][number] & { favorite?: boolean };
export type LegacyData = Omit<WorkspaceData, "meta" | "projects" | "tasks" | "users"> & {
  meta: { seedVersion: number; seededAt: string };
  projects: LegacyProject[];
  tasks: (Omit<Task, "doneAt"> & { doneAt?: string | null })[];
  users: (Omit<WorkspaceData["users"][number], "favoriteProjectIds"> & { favoriteProjectIds?: string[] })[];
};

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fill = (text: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((out, [key, value]) => out.split(`{${key}}`).join(value), text);

/**
 * Short history: one delivery per catalog event, across the three channels, with recipients
 * and tasks taken from the seed itself. Two failures exercise the resend flow: SMS without a
 * provider fails again; the e-mail refused by the destination server is delivered on resend.
 */
export function buildSeedNotifications(db: WorkspaceData, now: Date): Notification[] {
  const out: Notification[] = [];
  const at = (offsetDays: number, hour: number, minute = 12) => {
    const d = new Date(now.getTime() + offsetDays * DAY);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };
  const push = (
    ts: string,
    channel: NotificationChannel,
    templateId: string,
    toUserId: string | null | undefined,
    vars: Record<string, string>,
    failReason: string | null = null,
  ) => {
    const tpl = db.notificationTemplates.find((t) => t.id === templateId);
    if (!tpl || !toUserId) return;
    out.push({
      id: `nf${out.length + 1}`,
      ts,
      channel,
      templateId,
      eventType: tpl.event,
      toUserId,
      subject: fill(tpl.subject, vars),
      body: fill(tpl.body, vars),
      status: failReason ? "failed" : "delivered",
      attempts: !failReason ? 1 : db.notificationProviders[channel].configured ? 3 : 1,
      failReason,
    });
  };
  const user = (id: string | null | undefined) => db.users.find((u) => u.id === id);
  const project = (id: string) => db.projects.find((p) => p.id === id);
  const ref = (id: string) => db.tasks.find((t) => t.id === id)?.ref ?? "?";
  const openTop = db.tasks.filter((t) => !t.parentId && t.status !== "done" && t.assigneeId);
  const assigned = (uid: string, channel: NotificationChannel, offset: number, hour: number) => {
    const t = openTop.find((x) => x.assigneeId === uid);
    const u = user(t?.assigneeId);
    if (!t || !u) return;
    push(at(offset, hour), channel, "nt-assigned", u.id, {
      ref: t.ref,
      nome: u.name.split(" ")[0] ?? u.name,
      titulo: t.title,
      projeto: project(t.projectId)?.name ?? "",
    });
  };
  assigned("u8", "email", -1, 15);
  assigned("u4", "whatsapp", -3, 10);
  // due soon: e-mail and SMS (event preferences); the SMS fails without a provider
  let dueSoon: Task | undefined;
  let dueDays = 0;
  for (let d = 1; d <= 3 && !dueSoon; d++) {
    dueDays = d;
    dueSoon = openTop.find((t) => t.dueDate === ymd(new Date(now.getTime() + d * DAY)));
  }
  if (dueSoon) {
    // sent yesterday morning: one more day was left at that moment
    const left = dueDays + 1;
    const vars = {
      ref: dueSoon.ref,
      titulo: dueSoon.title,
      dias: String(left),
      prazo: `${left} ${left === 1 ? "dia" : "dias"}`,
    };
    push(at(-1, 8, 4), "email", "nt-due", dueSoon.assigneeId, vars);
    push(at(-1, 8, 4), "sms", "nt-due", dueSoon.assigneeId, vars, "Provedor de SMS não configurado");
  }
  const mention = db.comments.find((c) => c.text.startsWith("@"));
  const mentioned = mention && db.users.find((u) => mention.text.startsWith(`@${u.name} `));
  if (mention && mentioned)
    push(mention.createdAt, "whatsapp", "nt-mention", mentioned.id, {
      ref: ref(mention.taskId),
      autor: user(mention.userId)?.name ?? "",
    });
  const started = db.sprints.find((s) => s.id === "sp-apc-5");
  const startedProject = started && project(started.projectId);
  if (started && startedProject)
    push(at(-10, 9), "email", "nt-sprint-start", startedProject.leadId, {
      sprint: started.name,
      projeto: startedProject.name,
      meta: started.goal,
    });
  const ended = db.sprints.find((s) => s.id === "sp-pcl-14");
  const endedProject = ended && project(ended.projectId);
  if (ended && endedProject)
    push(
      at(-14, 18),
      "email",
      "nt-sprint-end",
      endedProject.leadId,
      (() => {
        const done = db.tasks.filter(
          (t) => t.sprintId === ended.id && !t.parentId && t.status === "done",
        ).length;
        return {
          sprint: ended.name,
          feitas: String(done),
          concluidas: `${done} ${done === 1 ? "tarefa concluída" : "tarefas concluídas"}`,
        };
      })(),
      "Servidor de destino recusou a mensagem (SMTP 452: caixa temporariamente indisponível)",
    );
  const blocked = openTop.find((t) => t.blockedBy.length);
  const firstBlocker = blocked?.blockedBy[0];
  if (blocked && firstBlocker)
    push(at(-2, 11), "email", "nt-blocked", blocked.assigneeId, {
      ref: blocked.ref,
      bloqueio: ref(firstBlocker),
    });
  return out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

/** Upgrades a saved (or freshly shifted) state to {@link SEED_VERSION}, keeping the person's changes. */
export function migrateToCurrent(input: LegacyData, now: Date): WorkspaceData {
  const data = input;
  if (data.meta.seedVersion >= SEED_VERSION) return data as WorkspaceData;
  // 8 → 9: completion date, favorites per person, template wording and lean notification history
  for (const t of data.tasks) if (t.doneAt === undefined) t.doneAt = t.status === "done" ? t.updatedAt : null;
  const globalFavorites = data.projects.filter((p) => p.favorite).map((p) => p.id);
  for (const u of data.users)
    if (!Array.isArray(u.favoriteProjectIds)) u.favoriteProjectIds = [...globalFavorites];
  for (const p of data.projects) delete p.favorite;
  for (const tpl of data.notificationTemplates) {
    tpl.subject = tpl.subject.replace(/^Sprint \{sprint\}/, "{sprint}");
    // plurals come ready in the variables ("1 dia", "2 tarefas concluídas")
    tpl.body = tpl.body
      .replace("vence em {dias} dia(s).", "vence em {prazo}.")
      .replace("foi encerrada com {feitas} tarefas concluídas.", "foi encerrada com {concluidas}.");
  }
  // the Visualizador cannot open the audit center (ms-audit scopes it to ADMIN, PM and TEAM_LEAD)
  for (const role of data.roles) role.name = ROLE_LABEL[role.id];
  for (const u of data.users) if (u.title === "Auditor Interno") u.title = "Gerente de Operações";
  const migrated = data as unknown as WorkspaceData;
  // deliveries produced by actions in this browser (ids "nf-<uuid>") are kept
  const own = migrated.notifications.filter((n) => n.id.startsWith("nf-"));
  migrated.notifications = [...own, ...buildSeedNotifications(migrated, now)].sort((a, b) =>
    a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0,
  );
  migrated.meta.seedVersion = SEED_VERSION;
  return migrated;
}

/** Source data is the original prototype's fictional seed, with dates relative to restoration. */
export function createDemoData(now = new Date()): WorkspaceData {
  const data = structuredClone(original) as unknown as LegacyData;
  const seedDate = new Date(data.meta.seededAt);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const seededDay = new Date(seedDate.getFullYear(), seedDate.getMonth(), seedDate.getDate());
  const shift = today.getTime() - seededDay.getTime();
  // some seeded instants (audit, comments, updates) are later than seededAt; shifting by the
  // elapsed time minus that overhang keeps every instant in the past and their relative order
  const instants: number[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value))
      instants.push(Date.parse(value));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect({ ...data, meta: null });
  const overhang = Math.max(0, ...instants.map((t) => t - seedDate.getTime()));
  const elapsed = now.getTime() - seedDate.getTime() - overhang - (overhang ? 60_000 : 0);
  const shiftValue = (value: unknown): unknown => {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(value)) {
      if (value.length === 10) {
        // date-only values are local calendar days: shift by whole days, never through UTC
        const [y, m, d] = value.split("-").map(Number) as [number, number, number];
        return ymd(new Date(y, m - 1, d + Math.round(shift / DAY)));
      }
      // instants keep their distance to "now" (a day-aligned shift could put them in the future)
      return new Date(new Date(value).getTime() + elapsed).toISOString();
    }
    if (Array.isArray(value)) return value.map(shiftValue);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftValue(item)]));
    return value;
  };
  const shifted = shiftValue(data) as LegacyData;
  shifted.meta.seededAt = now.toISOString();
  return migrateToCurrent(shifted, now);
}
