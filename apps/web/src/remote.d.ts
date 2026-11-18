// Contract of the Insights remote (apps/insights/src/types.ts and mount.ts). Kept by hand:
// the host never imports the remote's source; the remote can be deployed on its own.
type InsightStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
type InsightRole = "admin" | "pm" | "lead" | "dev" | "viewer";

declare module "insights/mount" {
  export interface InsightsRemoteProps {
    /** Page rendered by the remote; the Workspace shell owns the navigation between them. */
    view: "executive" | "analytics" | "audit";
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
      color: string;
    }>;
    tasks: Array<{
      id: string;
      ref: string;
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
      /** Moment the task entered "done"; completion metrics use it, never updatedAt. */
      doneAt: string | null;
    }>;
    users: Array<{
      id: string;
      name: string;
      email: string;
      initials: string;
      color: string;
      teamIds: string[];
      roleId: InsightRole;
      active: boolean;
      orgId: string;
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
    roleId: InsightRole;
    canAudit: boolean;
    meId: string;
    roles: Array<{ id: string; name: string }>;
    openTask?: (taskId: string) => void;
  }
  /** Unmount callback that also receives new props without remounting (older remotes: no update). */
  export interface InsightsHandle {
    (): void;
    update?: (props: InsightsRemoteProps) => void;
  }

  export function mount(element: HTMLElement, props: InsightsRemoteProps): InsightsHandle;
}
