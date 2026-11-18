import { z } from "zod";
import raw from "./demo-seed.json" with { type: "json" };

/**
 * Shape of the prototype seed (copy of apps/web/src/data/demo-seed.json, the source the
 * Workspace demo uses). Only the parts the backend seeds consume are typed; notifications,
 * templates and settings stay with the web demo.
 */
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
const priority = z.enum(["urgent", "high", "medium", "low"]);

export const legacySeedSchema = z.object({
  meta: z.object({ seedVersion: z.number(), seededAt: instant }),
  orgs: z.array(z.object({ id: z.string(), name: z.string(), slug: z.string(), desc: z.string() })),
  roles: z.array(z.object({ id: z.enum(["admin", "pm", "lead", "dev", "viewer"]), name: z.string() })),
  users: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      initials: z.string(),
      color: z.string(),
      title: z.string(),
      roleId: z.enum(["admin", "pm", "lead", "dev", "viewer"]),
      orgId: z.string(),
      teamIds: z.array(z.string()),
      active: z.boolean(),
    }),
  ),
  teams: z.array(
    z.object({
      id: z.string(),
      orgId: z.string(),
      name: z.string(),
      desc: z.string(),
      leadId: z.string(),
      memberIds: z.array(z.string()),
    }),
  ),
  projects: z.array(
    z.object({
      id: z.string(),
      orgId: z.string(),
      key: z.string(),
      name: z.string(),
      desc: z.string(),
      teamIds: z.array(z.string()),
      leadId: z.string(),
      priority,
      status: z.enum(["active", "paused", "done"]),
      startDate: ymd,
      targetDate: ymd.nullable(),
      archived: z.boolean(),
      createdAt: instant,
      color: z.string(),
    }),
  ),
  epics: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      name: z.string(),
      desc: z.string(),
      status: z.enum(["active", "done"]),
      ownerId: z.string(),
    }),
  ),
  sprints: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      name: z.string(),
      goal: z.string(),
      status: z.enum(["planned", "active", "done"]),
      startDate: ymd,
      endDate: ymd,
    }),
  ),
  milestones: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      name: z.string(),
      date: ymd,
      status: z.enum(["open", "done"]),
    }),
  ),
  tasks: z.array(
    z.object({
      id: z.string(),
      ref: z.string(),
      projectId: z.string(),
      epicId: z.string().nullable(),
      parentId: z.string().nullable(),
      type: z.enum(["task", "bug", "subtask"]),
      title: z.string(),
      desc: z.string(),
      status: z.enum(["backlog", "todo", "in_progress", "in_review", "done"]),
      priority,
      assigneeId: z.string().nullable(),
      teamId: z.string().nullable(),
      sprintId: z.string().nullable(),
      labels: z.array(z.string()),
      acceptance: z.array(z.object({ text: z.string(), done: z.boolean() })),
      blockedBy: z.array(z.string()),
      createdAt: instant,
      updatedAt: instant,
      dueDate: ymd.nullable(),
      createdBy: z.string(),
    }),
  ),
  comments: z.array(
    z.object({
      id: z.string(),
      taskId: z.string(),
      userId: z.string(),
      text: z.string(),
      createdAt: instant,
    }),
  ),
  audit: z.array(
    z.object({
      id: z.string(),
      ts: instant,
      userId: z.string(),
      action: z.string(),
      entityType: z.string(),
      entityId: z.string().nullable(),
      projectId: z.string().nullable(),
      before: z.unknown(),
      after: z.unknown(),
      summary: z.string(),
      source: z.string(),
    }),
  ),
});
export type LegacySeed = z.infer<typeof legacySeedSchema>;
export type LegacyRoleId = LegacySeed["users"][number]["roleId"];

/** The original instants (seeded at `meta.seededAt`), parsed once. Parse failures are fatal. */
export const legacySeed: LegacySeed = legacySeedSchema.parse(raw);

/**
 * Every instant of the whole original file except `meta` (notifications included), as the web
 * shift collects them; needed to reproduce the same overhang correction.
 */
export const legacyInstants: number[] = (() => {
  const out: number[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) out.push(Date.parse(value));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect({ ...raw, meta: null });
  return out;
})();
