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
import { READ_SCOPE, WRITE_SCOPE } from "../scopes.js";
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
  aggregateId: z
    .uuid()
    .optional()
    .describe("Only events about this entity (a task, sprint, epic… id), e.g. to answer who changed it"),
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

/** The notification catalog of ms-notifications: the task events it delivers, named as ms-projects emits them. */
const NOTIFICATION_EVENTS = [
  "task.assigned",
  "task.updated",
  "task.status_changed",
  "task.completed",
] as const;
const channel = z.enum(["email", "sms", "whatsapp"]).describe("Delivery channel: email, sms or whatsapp");
const NotificationId = z.object({ notificationId: id("Delivery id (from list-notifications)") });
const EventPreference = z.object({
  event: z
    .enum(NOTIFICATION_EVENTS)
    .describe("Notification event, as listed by get-notification-preferences (e.g. task.assigned)"),
  channel,
  enabled: z.boolean().describe("true to receive this event on this channel, false to mute it"),
});

type Input<T extends z.ZodType> = z.infer<T>;

const read = [READ_SCOPE];
const write = [WRITE_SCOPE];

/**
 * Audit trail (ms-audit), the caller's own notifications (ms-notifications) and the organization directory
 * (ms-identity). Each service checks the forwarded token itself. Identity administration (teams, members,
 * invitations, project access) is not exposed here: ms-identity accepts delegated tokens only on its
 * read-only directory.
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
    scopes: read,
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
    scopes: read,
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
    scopes: read,
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
    scopes: read,
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
    scopes: write,
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
    scopes: write,
  })
  retryNotification({ notificationId }: Input<typeof NotificationId>, ctx: McpContext) {
    return this.api.request(ctx, "notifications", `/notifications/${notificationId}/retry`, {
      method: "POST",
    });
  }

  @Tool({
    name: "list-members",
    title: "List organization members",
    description:
      "List the people of the caller's organization: id, name, email, title, role, active flag and team ids. Use it to turn user ids (assignees, authors, audit actors) into names, or to find who to assign.",
    annotations: READ_ONLY,
    scopes: read,
  })
  listMembers(_input: unknown, ctx: McpContext) {
    return this.api.get(ctx, "identity", "/organization/members");
  }

  @Tool({
    name: "list-teams",
    title: "List teams",
    description:
      "List the teams of the caller's organization: id, name, description, lead, member ids and active flag.",
    annotations: READ_ONLY,
    scopes: read,
  })
  listTeams(_input: unknown, ctx: McpContext) {
    return this.api.get(ctx, "identity", "/organization/teams");
  }
}
