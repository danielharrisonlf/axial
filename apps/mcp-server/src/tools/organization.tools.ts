import { eventTypes } from "@axial/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { type McpContext, Tool } from "@nestjs/mcp";
import { z } from "zod";
import { McpPrimitives } from "../mcp/primitives.js";
import {
  auditEventOut,
  auditSummaryOut,
  id,
  page,
  pageOf,
  pageSize,
  READ_ONLY,
  WRITE,
  WRITE_IDEMPOTENT,
} from "../schemas.js";
import { SCOPES } from "../scopes.js";
import { AxialApi } from "../upstream.js";

const isoFilter = (what: string) =>
  z.iso.datetime({ offset: true }).optional().describe(`${what}, an ISO 8601 timestamp with offset`);

const SearchAudit = z.object({
  projectId: z.uuid().optional().describe("Only events of this project"),
  actorId: z.uuid().optional().describe("Only events by this user"),
  eventType: z.enum(eventTypes).optional().describe("Only this event type (e.g. task.completed)"),
  aggregateType: z
    .enum(["project", "epic", "task", "sprint", "comment", "milestone"])
    .optional()
    .describe("Only events about this kind of entity"),
  from: isoFilter("Events at or after"),
  to: isoFilter("Events at or before"),
  search: z.string().trim().max(160).optional().describe("Free text matched by the audit service"),
  page,
  pageSize,
});
const AuditSummary = z.object({
  projectId: z.uuid().optional().describe("Only events of this project"),
  from: isoFilter("Events at or after"),
  to: isoFilter("Events at or before"),
});

/** The notification catalog of ms-notifications (its own names, versioned with a .v1 suffix). */
const NOTIFICATION_EVENTS = [
  "task.assigned.v1",
  "task.updated.v1",
  "task.status_changed.v1",
  "task.completed.v1",
  "task.blocked.v1",
] as const;
const channel = z.enum(["email", "sms", "whatsapp"]).describe("Delivery channel: email, sms or whatsapp");
const NotificationId = z.object({ notificationId: id("Delivery id (from list-notifications)") });
const EventPreference = z.object({
  event: z
    .enum(NOTIFICATION_EVENTS)
    .describe("Notification event, as listed by get-notification-preferences (e.g. task.assigned.v1)"),
  channel,
  enabled: z.boolean().describe("true to receive this event on this channel, false to mute it"),
});

const CreateTeam = z.object({ name: z.string().trim().min(1).max(120).describe("Team name") });
const UpdateTeam = z
  .object({
    teamId: id("Team id"),
    name: z.string().trim().min(1).max(120).optional().describe("New team name"),
    active: z.boolean().optional().describe("false deactivates the team, true reactivates it"),
  })
  .refine((value) => value.name !== undefined || value.active !== undefined, "Give name or active");
const TeamMember = z.object({
  teamId: id("Team id"),
  userId: id("Member user id"),
  enabled: z.boolean().describe("true adds the user to the team, false removes them"),
});
const ProjectAccess = z.object({
  userId: id("Member user id"),
  projectId: id("Project id"),
  enabled: z.boolean().describe("true grants explicit access to the project, false revokes it"),
});

type Input<T extends z.ZodType> = z.infer<T>;

/**
 * Audit trail (ms-audit), the caller's own notifications (ms-notifications) and organization teams and
 * members (ms-identity). Each service checks the forwarded token itself.
 */
@Injectable()
@McpPrimitives()
export class OrganizationTools {
  constructor(@Inject(AxialApi) private readonly api: AxialApi) {}

  @Tool({
    name: "search-audit",
    title: "Search audit trail",
    description:
      "Search the append-only audit trail of domain events (who changed what, when and from which source), newest first. Admins see the organization; managers and team leads only projects in their token. Use it to answer 'who moved/changed X'.",
    inputSchema: SearchAudit,
    outputSchema: pageOf(auditEventOut),
    annotations: READ_ONLY,
    scopes: [SCOPES.auditRead],
  })
  searchAudit(input: Input<typeof SearchAudit>, ctx: McpContext) {
    return this.api.get(ctx, "audit", "/audit", input);
  }

  @Tool({
    name: "audit-summary",
    title: "Audit summary",
    description:
      "Count audit events by type, by actor (top 20) and by day, for a period and optionally one project.",
    inputSchema: AuditSummary,
    outputSchema: auditSummaryOut,
    annotations: READ_ONLY,
    scopes: [SCOPES.auditRead],
  })
  auditSummary(input: Input<typeof AuditSummary>, ctx: McpContext) {
    return this.api.get(ctx, "audit", "/audit/summary", input);
  }

  @Tool({
    name: "list-notifications",
    title: "My notifications",
    description:
      "List the signed-in user's latest 100 notification deliveries: event type, channel, delivery status and attempts.",
    annotations: READ_ONLY,
    scopes: [SCOPES.notificationsRead],
  })
  listNotifications(_input: unknown, ctx: McpContext) {
    return this.api.get(ctx, "notifications", "/notifications");
  }

  @Tool({
    name: "get-notification-preferences",
    title: "My notification preferences",
    description:
      "Read the signed-in user's notification channels (enabled, destination, verified) and the per-event, per-channel switches.",
    annotations: READ_ONLY,
    scopes: [SCOPES.notificationsRead],
  })
  async preferences(_input: unknown, ctx: McpContext) {
    const [channels, events] = await Promise.all([
      this.api.get(ctx, "notifications", "/notification-preferences"),
      this.api.get(ctx, "notifications", "/notification-event-preferences"),
    ]);
    return { channels, events };
  }

  @Tool({
    name: "set-notification-event-preference",
    title: "Mute or unmute an event",
    description:
      "Turn one event on or off for one of the signed-in user's channels. Changing the channel destination is not available here: it needs a verification code the user must type in the Workspace.",
    inputSchema: EventPreference,
    annotations: WRITE_IDEMPOTENT,
    scopes: [SCOPES.notificationsWrite],
  })
  setEventPreference({ event, channel: kind, enabled }: Input<typeof EventPreference>, ctx: McpContext) {
    return this.api.request(
      ctx,
      "notifications",
      `/notification-event-preferences/${encodeURIComponent(event)}/${kind}`,
      { method: "PATCH", body: { enabled } },
    );
  }

  @Tool({
    name: "retry-notification",
    title: "Retry a failed notification",
    description:
      "Queue a failed or pending delivery of the signed-in user for another attempt. Delivered notifications cannot be retried (conflict).",
    inputSchema: NotificationId,
    annotations: WRITE,
    scopes: [SCOPES.notificationsWrite],
  })
  retryNotification({ notificationId }: Input<typeof NotificationId>, ctx: McpContext) {
    return this.api.request(ctx, "notifications", `/notifications/${notificationId}/retry`, {
      method: "POST",
    });
  }

  @Tool({
    name: "list-members",
    title: "List organization members",
    description: "List the organization's members with email, role and active flag (administrators only).",
    annotations: READ_ONLY,
    scopes: [SCOPES.identityRead],
  })
  listMembers(_input: unknown, ctx: McpContext) {
    return this.api.get(ctx, "identity", "/members");
  }

  @Tool({
    name: "list-teams",
    title: "List teams",
    description: "List the organization's teams with their active flag (administrators only).",
    annotations: READ_ONLY,
    scopes: [SCOPES.identityRead],
  })
  listTeams(_input: unknown, ctx: McpContext) {
    return this.api.get(ctx, "identity", "/teams");
  }

  @Tool({
    name: "create-team",
    title: "Create team",
    description:
      "Create a team in the organization (administrators only). Confirm the name with the user first.",
    inputSchema: CreateTeam,
    annotations: WRITE,
    scopes: [SCOPES.identityWrite],
  })
  createTeam(body: Input<typeof CreateTeam>, ctx: McpContext) {
    return this.api.request(ctx, "identity", "/teams", { method: "POST", body });
  }

  @Tool({
    name: "update-team",
    title: "Rename or deactivate team",
    description: "Rename a team or change its active flag (administrators only).",
    inputSchema: UpdateTeam,
    annotations: WRITE_IDEMPOTENT,
    scopes: [SCOPES.identityWrite],
  })
  updateTeam({ teamId, ...body }: Input<typeof UpdateTeam>, ctx: McpContext) {
    return this.api.request(ctx, "identity", `/teams/${teamId}`, { method: "PATCH", body });
  }

  @Tool({
    name: "set-team-member",
    title: "Add or remove team member",
    description:
      "Add an active member to a team or remove them (administrators only). Takes effect in that user's next access token.",
    inputSchema: TeamMember,
    annotations: WRITE_IDEMPOTENT,
    scopes: [SCOPES.identityWrite],
  })
  setTeamMember({ teamId, userId, enabled }: Input<typeof TeamMember>, ctx: McpContext) {
    return this.api.request(ctx, "identity", `/teams/${teamId}/members/${userId}`, {
      method: "POST",
      body: { enabled },
    });
  }

  @Tool({
    name: "set-project-access",
    title: "Grant or revoke project access",
    description:
      "Grant a member explicit access to a project or revoke it (administrators only). Takes effect in that user's next access token.",
    inputSchema: ProjectAccess,
    annotations: WRITE_IDEMPOTENT,
    scopes: [SCOPES.identityWrite],
  })
  setProjectAccess({ userId, projectId, enabled }: Input<typeof ProjectAccess>, ctx: McpContext) {
    return this.api.request(ctx, "identity", `/members/${userId}/projects/${projectId}`, {
      method: "POST",
      body: { enabled },
    });
  }
}
