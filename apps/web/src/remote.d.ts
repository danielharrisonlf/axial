type InsightStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";

declare module "insights/mount" {
  export interface InsightsRemoteProps {
    projects: Array<{
      id: string;
      orgId: string;
      name: string;
      key: string;
      status: "active" | "paused" | "done";
      targetDate: string | null;
      leadId: string;
      teamIds: string[];
      archived: boolean;
    }>;
    tasks: Array<{
      id: string;
      projectId: string;
      title: string;
      status: InsightStatus;
      priority: "urgent" | "high" | "medium" | "low";
      assigneeId: string | null;
      teamId: string | null;
      sprintId: string | null;
      parentId: string | null;
      blockedBy: string[];
      createdAt: string;
      updatedAt: string;
      dueDate: string | null;
    }>;
    users: Array<{
      id: string;
      name: string;
      email: string;
      initials: string;
      color: string;
      teamIds: string[];
      roleId: "admin" | "pm" | "lead" | "dev" | "viewer";
      active: boolean;
    }>;
    teams: Array<{ id: string; name: string; orgId: string }>;
    sprints: Array<{
      id: string;
      projectId: string;
      name: string;
      status: "planned" | "active" | "done";
      startDate: string;
      endDate: string;
    }>;
    orgs: Array<{ id: string; name: string }>;
    audit: Array<{
      id: string;
      ts: string;
      userId: string;
      action: string;
      entityType: string;
      entityId: string | null;
      projectId: string | null;
      before: unknown;
      after: unknown;
      summary: string;
      source: string;
    }>;
    roleId: "admin" | "pm" | "lead" | "dev" | "viewer";
    canAudit: boolean;
    theme?: "light" | "dark";
  }

  export function mount(element: HTMLElement, props: InsightsRemoteProps): () => void;
}
