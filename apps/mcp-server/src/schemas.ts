import {
  acceptanceCriterionInputSchema,
  createCommentSchema,
  createEpicSchema,
  createMilestoneSchema,
  createProjectSchema,
  createSprintSchema,
  createTaskSchema,
  prioritySchema,
  projectColorSchema,
  projectStatusSchema,
  roleSchema,
  sourceSchema,
  sprintStatusSchema,
  taskStatusSchema,
  taskTypeSchema,
} from "@axial/contracts";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";

/*
 * Input fields reuse the shared @axial/contracts validators, so the MCP layer accepts exactly what the
 * services accept, with a description for the model on every argument.
 */

export const id = (what: string) => z.uuid().describe(what);
export const version = (what: string) =>
  z
    .number()
    .int()
    .positive()
    .describe(`Current ${what} version, from the latest read. A stale version is rejected with a conflict`);
export const page = z.number().int().positive().optional().describe("Page number, starting at 1 (default 1)");
export const pageSize = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Items per page, 1 to 100 (default 25)");
export const isoDate = (what: string) =>
  z.iso
    .datetime({ offset: true })
    .describe(`${what}, an ISO 8601 timestamp with offset (e.g. 2026-11-20T00:00:00Z)`);
export const nullableIsoDate = (what: string) =>
  z.iso
    .datetime({ offset: true })
    .nullable()
    .optional()
    .describe(`${what}, an ISO 8601 timestamp with offset, or null to clear it`);
export const nullableId = (what: string) =>
  z.uuid().nullable().optional().describe(`${what}, or null to clear it`);

export const taskStatus = taskStatusSchema.describe(
  "Kanban status: backlog, todo, in_progress, in_review or done",
);
export const priority = prioritySchema.describe("Priority: low, medium, high or urgent");
export const projectStatus = projectStatusSchema.describe("Project status: active, paused or done");
export const taskType = taskTypeSchema.describe(
  "Task type: task, bug or subtask (a subtask needs parentId, one level only)",
);

const task = createTaskSchema.shape;
export const taskFields = {
  title: task.title.describe("Short task title, up to 240 characters"),
  description: z
    .string()
    .trim()
    .max(20_000)
    .optional()
    .describe("Markdown description, up to 20000 characters"),
  status: taskStatus.optional(),
  priority: priority.optional(),
  assigneeId: nullableId("User id to assign; must be assignable by the caller"),
  teamId: nullableId("Owning team id"),
  epicId: nullableId("Epic id of the same project"),
  sprintId: nullableId("Sprint id of the same project (not a completed sprint)"),
  labels: task.labels.unwrap().optional().describe("Labels, up to 30, each up to 40 characters"),
  acceptanceCriteria: z
    .array(acceptanceCriterionInputSchema)
    .max(50)
    .optional()
    .describe(
      "Acceptance criteria, up to 50 items, each {text, done} (done defaults to false; a plain string is read as an open criterion). Replaces the current list",
    ),
  estimate: z.number().int().min(0).max(1000).nullable().optional().describe("Estimate in points, or null"),
  position: z.number().int().min(0).max(100_000_000).optional().describe("Order inside the Kanban column"),
  startDate: nullableIsoDate("Start date"),
  dueDate: nullableIsoDate("Due date"),
  blockedByIds: task.blockedByIds
    .unwrap()
    .optional()
    .describe("Ids of tasks of the same project that must be done before this one (replaces the list)"),
};

const project = createProjectSchema.shape;
export const projectFields = {
  key: project.key.describe(
    "Immutable project key: an uppercase letter then 1 to 11 uppercase letters or digits (e.g. CHK). Task references become KEY-1, KEY-2…",
  ),
  name: project.name.describe("Project name, up to 160 characters"),
  description: z.string().trim().max(20_000).optional().describe("Markdown description"),
  color: projectColorSchema
    .nullable()
    .optional()
    .describe("Project color as a six digit hex value (e.g. #3b82f6), or null to clear it"),
  priority: priority.optional(),
  leadId: nullableId("Project lead user id"),
  teamIds: project.teamIds
    .unwrap()
    .optional()
    .describe("Team ids that own the project (assignable by the caller)"),
  startDate: nullableIsoDate("Start date"),
  endDate: nullableIsoDate("Target end date, not before the start date"),
};

export const epicFields = {
  title: createEpicSchema.shape.title.describe("Epic title, up to 240 characters"),
  description: z.string().trim().max(20_000).optional().describe("Markdown description"),
  ownerId: nullableId("Owner user id"),
};

export const sprintFields = {
  name: createSprintSchema.shape.name.describe("Sprint name, up to 160 characters"),
  goal: z.string().trim().max(2000).optional().describe("Sprint goal in one or two sentences"),
  startDate: isoDate("Sprint start"),
  endDate: isoDate("Sprint end, strictly after the start"),
};

export const commentBody = createCommentSchema.shape.body.describe(
  "Comment text (Markdown), up to 10000 characters",
);
export const milestoneFields = {
  name: createMilestoneSchema.shape.name.describe("Milestone name, up to 160 characters"),
  date: isoDate("Milestone date"),
};

export const confirm = z
  .boolean()
  .optional()
  .describe(
    "Only for clients without elicitation: true after the user explicitly confirmed this exact operation. Clients with elicitation are asked directly",
  );

/* Annotations: hints for clients deciding when to ask the user. */
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
export const WRITE_IDEMPOTENT: ToolAnnotations = { ...WRITE, idempotentHint: true };
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

/* Output schemas of the main reads. Loose objects: services may add fields without breaking clients. */

const timestamp = z.string().describe("ISO 8601 timestamp");
const nullableTimestamp = z.string().nullable();

export const projectOut = z.looseObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string().nullable().optional().describe("Six digit hex color, or null"),
  status: projectStatusSchema,
  priority: prioritySchema,
  leadId: z.uuid().nullable(),
  teamIds: z.array(z.uuid()),
  startDate: nullableTimestamp,
  endDate: nullableTimestamp,
  archivedAt: nullableTimestamp,
  version: z.number().int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const taskOut = z.looseObject({
  id: z.uuid(),
  projectId: z.uuid(),
  ref: z.string().describe("Stable human reference, KEY-number"),
  title: z.string(),
  description: z.string(),
  type: taskTypeSchema,
  status: taskStatusSchema,
  priority: prioritySchema,
  assigneeId: z.uuid().nullable(),
  teamId: z.uuid().nullable(),
  epicId: z.uuid().nullable(),
  sprintId: z.uuid().nullable(),
  parentId: z.uuid().nullable(),
  labels: z.array(z.string()),
  acceptanceCriteria: z
    .array(z.looseObject({ text: z.string(), done: z.boolean() }))
    .describe("Acceptance criteria, each {text, done}"),
  estimate: z.number().int().nullable(),
  position: z.number().int(),
  startDate: nullableTimestamp,
  dueDate: nullableTimestamp,
  completedAt: nullableTimestamp,
  version: z.number().int(),
  dependencies: z
    .array(z.looseObject({ dependsOnId: z.uuid() }))
    .optional()
    .describe("Tasks that block this one"),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const sprintOut = z.looseObject({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  goal: z.string(),
  status: sprintStatusSchema,
  startDate: timestamp,
  endDate: timestamp,
  startedAt: nullableTimestamp,
  completedAt: nullableTimestamp,
  version: z.number().int(),
});

export const epicOut = z.looseObject({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  description: z.string(),
  status: taskStatusSchema,
  ownerId: z.uuid().nullable(),
  version: z.number().int(),
});

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().describe("Total matching items across all pages"),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

export const summaryOut = z.looseObject({
  projectId: z.uuid(),
  total: z.number().int().describe("Top-level tasks (subtasks are not counted)"),
  done: z.number().int(),
  byStatus: z.record(z.string(), z.number().int()),
  overdue: z.number().int().describe("Unfinished tasks whose due date has passed"),
  completionPercent: z.number(),
  estimatedPoints: z.number(),
  completedPoints: z.number(),
});

export const auditEventOut = z.looseObject({
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  eventType: z.string(),
  aggregateType: z.string(),
  aggregateId: z.uuid(),
  aggregateVersion: z.number().int(),
  actorId: z.uuid(),
  actorSource: sourceSchema,
  correlationId: z.string(),
  occurredAt: timestamp,
});

export const auditSummaryOut = z.looseObject({
  total: z.number().int(),
  byEventType: z.array(z.object({ eventType: z.string(), count: z.number().int() })),
  byActor: z.array(z.object({ actorId: z.uuid(), count: z.number().int() })),
  byDay: z.array(z.object({ day: z.string(), count: z.number().int() })),
});

export const identityOut = z.object({
  userId: z.uuid(),
  organizationId: z.uuid(),
  role: roleSchema,
  source: sourceSchema,
  teamIds: z.array(z.uuid()),
  projectIds: z.array(z.uuid()),
  scopes: z.array(z.string()),
  expiresAt: z.string().describe("When the access token expires (ISO 8601)"),
  transport: z.enum(["http", "stdio"]),
});

export type Project = z.infer<typeof projectOut>;
export type Task = z.infer<typeof taskOut>;
export type Sprint = z.infer<typeof sprintOut>;
export type Summary = z.infer<typeof summaryOut>;
