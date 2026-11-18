import type {
  CreateEpic,
  CreateMilestone,
  CreateProject,
  CreateSprint,
  CreateTask,
  Role,
  UpdateMilestone,
  UpdateProject,
  UpdateTask,
} from "@axial/contracts";
import { roleSchema } from "@axial/contracts";
import { z } from "zod";
import type { HttpClient } from "./http";
import {
  apiCommentSchema,
  apiEpicSchema,
  apiInvitationSchema,
  apiMilestoneSchema,
  apiProjectSchema,
  apiSprintSchema,
  apiTaskSchema,
} from "./mappers";

/**
 * Write calls of the Workspace. Bodies follow the @axial/contracts input schemas; every update
 * carries the resource version the interface last saw (409 when someone changed it meanwhile).
 * Responses are validated like the reads.
 */

/** Input form of the contracts (defaults are optional when sending). */
type Input<T> = Partial<T>;

export function createCommands(http: HttpClient) {
  const post = (path: string, body?: unknown) => http.request<unknown>(path, { method: "POST", body });
  const patch = (path: string, body: unknown) => http.request<unknown>(path, { method: "PATCH", body });
  return {
    createProject: async (body: Input<CreateProject> & Pick<CreateProject, "key" | "name">) =>
      apiProjectSchema.parse(await post("/projects", body)),
    updateProject: async (id: string, body: Input<UpdateProject> & { version: number }) =>
      apiProjectSchema.parse(await patch(`/projects/${id}`, body)),
    archiveProject: async (id: string, version: number, restore: boolean) =>
      apiProjectSchema.parse(await post(`/projects/${id}/${restore ? "restore" : "archive"}`, { version })),
    createEpic: async (projectId: string, body: Input<CreateEpic> & Pick<CreateEpic, "title">) =>
      apiEpicSchema.parse(await post(`/projects/${projectId}/epics`, body)),
    createTask: async (projectId: string, body: Input<CreateTask> & Pick<CreateTask, "title">) =>
      apiTaskSchema.parse(await post(`/projects/${projectId}/tasks`, body)),
    updateTask: async (id: string, body: Input<UpdateTask> & { version: number }) =>
      apiTaskSchema.parse(await patch(`/tasks/${id}`, body)),
    moveTask: async (id: string, body: { version: number; status: CreateTask["status"] }) =>
      apiTaskSchema.parse(await patch(`/tasks/${id}/status`, body)),
    deleteTask: (id: string, version: number) =>
      http.request<unknown>(`/tasks/${id}`, { method: "DELETE", query: { version } }),
    createComment: async (taskId: string, body: string) =>
      apiCommentSchema.parse(await post(`/tasks/${taskId}/comments`, { body })),
    createSprint: async (projectId: string, body: CreateSprint) =>
      apiSprintSchema.parse(await post(`/projects/${projectId}/sprints`, body)),
    startSprint: async (id: string, version: number) =>
      apiSprintSchema.parse(await post(`/sprints/${id}/start`, { version })),
    completeSprint: (id: string, version: number) => post(`/sprints/${id}/complete`, { version }),
    createMilestone: async (projectId: string, body: CreateMilestone) =>
      apiMilestoneSchema.parse(await post(`/projects/${projectId}/milestones`, body)),
    updateMilestone: async (id: string, body: Input<UpdateMilestone> & { version: number }) =>
      apiMilestoneSchema.parse(await patch(`/milestones/${id}`, body)),
    updateMember: async (userId: string, body: { role?: Role; active?: boolean }) =>
      z
        .object({ id: z.string(), role: roleSchema, active: z.boolean() })
        .parse(await patch(`/members/${userId}`, body)),
    createInvitation: async (body: { email: string; role: Role; teamIds?: string[]; title?: string }) =>
      z
        .object({ id: z.string(), url: z.string(), expiresAt: z.string() })
        .parse(await post("/invitations", body)),
    listInvitations: async () =>
      z.array(apiInvitationSchema).parse(await http.request<unknown>("/invitations")),
    revokeInvitation: (id: string) => http.request<unknown>(`/invitations/${id}`, { method: "DELETE" }),
    /** Own delivery channels in ms-notifications (read only in the Workspace for now). */
    notificationPreferences: async () =>
      z
        .array(
          z.object({
            channel: z.string(),
            enabled: z.boolean(),
            destination: z.string().nullable(),
            verified: z.boolean(),
          }),
        )
        .parse(await http.request<unknown>("/notification-preferences")),
  };
}
export type Commands = ReturnType<typeof createCommands>;
