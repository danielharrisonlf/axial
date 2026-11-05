import { z } from "zod";

export const idSchema = z.uuid();
export const roleSchema = z.enum(["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"]);
export const taskStatusSchema = z.enum(["backlog", "todo", "in_progress", "in_review", "done"]);
export const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const projectStatusSchema = z.enum(["active", "paused", "done"]);
export const sprintStatusSchema = z.enum(["planned", "active", "done"]);
export const taskTypeSchema = z.enum(["task", "bug", "subtask"]);
export const sourceSchema = z.enum(["ui", "api", "mcp", "automation"]);
export type Role = z.infer<typeof roleSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type EventSource = z.infer<typeof sourceSchema>;

export interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
  teamIds: string[];
  projectIds: string[];
  assignableUserIds: string[];
  assignableTeamIds: string[];
  source: EventSource;
  correlationId: string;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const description = z.string().trim().max(20000);
const nullableId = idSchema.nullable().optional();
const date = z.iso.datetime({ offset: true });
const nullableDate = date.nullable().optional();
export const versionSchema = z.object({ version: z.number().int().positive() }).strict();
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const projectListSchema = paginationSchema
  .extend({
    search: z.string().max(160).optional(),
    status: projectStatusSchema.optional(),
    archived: z.enum(["true", "false"]).default("false"),
  })
  .strict();
export const createProjectSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9]{1,11}$/),
    name: text(160),
    description: description.default(""),
    priority: prioritySchema.default("medium"),
    leadId: nullableId,
    teamIds: z.array(idSchema).max(100).default([]),
    startDate: nullableDate,
    endDate: nullableDate,
  })
  .strict();
export const updateProjectSchema = createProjectSchema
  .omit({ key: true })
  .extend({
    description: createProjectSchema.shape.description.unwrap(),
    priority: createProjectSchema.shape.priority.unwrap(),
    teamIds: createProjectSchema.shape.teamIds.unwrap(),
  })
  .partial()
  .extend({
    version: z.number().int().positive(),
    status: projectStatusSchema.optional(),
  })
  .strict();
export const createEpicSchema = z
  .object({
    title: text(240),
    description: description.default(""),
    ownerId: nullableId,
  })
  .strict();
export const updateEpicSchema = createEpicSchema
  .extend({ description: createEpicSchema.shape.description.unwrap() })
  .partial()
  .extend({
    version: z.number().int().positive(),
    status: taskStatusSchema.optional(),
  })
  .strict();
export const createTaskSchema = z
  .object({
    title: text(240),
    description: description.default(""),
    type: taskTypeSchema.default("task"),
    status: taskStatusSchema.default("backlog"),
    priority: prioritySchema.default("medium"),
    assigneeId: nullableId,
    teamId: nullableId,
    epicId: nullableId,
    sprintId: nullableId,
    parentId: nullableId,
    labels: z.array(text(40)).max(30).default([]),
    acceptanceCriteria: z.array(text(1000)).max(50).default([]),
    estimate: z.number().int().min(0).max(1000).nullable().optional(),
    position: z.number().int().min(0).max(100000000).default(0),
    startDate: nullableDate,
    dueDate: nullableDate,
    blockedByIds: z.array(idSchema).max(100).default([]),
  })
  .strict();
export const updateTaskSchema = createTaskSchema
  .omit({ type: true, parentId: true })
  .extend({
    description: createTaskSchema.shape.description.unwrap(),
    status: createTaskSchema.shape.status.unwrap(),
    priority: createTaskSchema.shape.priority.unwrap(),
    labels: createTaskSchema.shape.labels.unwrap(),
    acceptanceCriteria: createTaskSchema.shape.acceptanceCriteria.unwrap(),
    position: createTaskSchema.shape.position.unwrap(),
    blockedByIds: createTaskSchema.shape.blockedByIds.unwrap(),
  })
  .partial()
  .extend({
    version: z.number().int().positive(),
  })
  .strict();
export const moveTaskSchema = z
  .object({
    version: z.number().int().positive(),
    status: taskStatusSchema,
    position: z.number().int().min(0).max(100000000).optional(),
  })
  .strict();
export const taskListSchema = paginationSchema
  .extend({
    search: z.string().max(240).optional(),
    status: taskStatusSchema.optional(),
    priority: prioritySchema.optional(),
    assigneeId: idSchema.optional(),
    teamId: idSchema.optional(),
    epicId: idSchema.optional(),
    sprintId: idSchema.optional(),
    parentId: idSchema.optional(),
    label: z.string().max(40).optional(),
  })
  .strict();
export const createSprintSchema = z
  .object({
    name: text(160),
    goal: z.string().trim().max(2000).default(""),
    startDate: date,
    endDate: date,
  })
  .strict();
export const updateSprintSchema = createSprintSchema
  .extend({ goal: createSprintSchema.shape.goal.unwrap() })
  .partial()
  .extend({
    version: z.number().int().positive(),
  })
  .strict();
export const createCommentSchema = z.object({ body: text(10000) }).strict();
export const updateCommentSchema = createCommentSchema
  .extend({ version: z.number().int().positive() })
  .strict();
export const createMilestoneSchema = z.object({ name: text(160), date }).strict();
export const updateMilestoneSchema = createMilestoneSchema
  .partial()
  .extend({
    version: z.number().int().positive(),
    completed: z.boolean().optional(),
  })
  .strict();

export type CreateProject = z.infer<typeof createProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;
export type ProjectList = z.infer<typeof projectListSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type CreateEpic = z.infer<typeof createEpicSchema>;
export type UpdateEpic = z.infer<typeof updateEpicSchema>;
export type CreateTask = z.infer<typeof createTaskSchema>;
export type UpdateTask = z.infer<typeof updateTaskSchema>;
export type MoveTask = z.infer<typeof moveTaskSchema>;
export type TaskList = z.infer<typeof taskListSchema>;
export type CreateSprint = z.infer<typeof createSprintSchema>;
export type UpdateSprint = z.infer<typeof updateSprintSchema>;
export type CreateComment = z.infer<typeof createCommentSchema>;
export type UpdateComment = z.infer<typeof updateCommentSchema>;
export type CreateMilestone = z.infer<typeof createMilestoneSchema>;
export type UpdateMilestone = z.infer<typeof updateMilestoneSchema>;

export const EVENT_DESTINATIONS = ["axial-realtime", "axial-notifications", "axial-audit"] as const;
export const eventTypes = [
  "project.created",
  "project.updated",
  "project.archived",
  "project.restored",
  "epic.created",
  "epic.updated",
  "epic.deleted",
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.completed",
  "task.assigned",
  "task.deleted",
  "sprint.created",
  "sprint.updated",
  "sprint.started",
  "sprint.completed",
  "sprint.deleted",
  "comment.created",
  "comment.updated",
  "comment.deleted",
  "milestone.created",
  "milestone.updated",
  "milestone.deleted",
] as const;
export type DomainEventType = (typeof eventTypes)[number];

export interface DomainEventEnvelope {
  id: string;
  type: DomainEventType;
  version: 1;
  occurredAt: string;
  organizationId: string;
  projectId: string | null;
  aggregate: { type: string; id: string; version: number };
  actor: { id: string; source: EventSource };
  correlationId: string;
  data: { before: unknown; after: unknown };
}
