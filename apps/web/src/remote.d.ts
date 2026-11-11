declare module "insights/mount" {
  export interface InsightsRemoteProps {
    projects: Array<{
      id: string;
      name: string;
      key: string;
      status: "active" | "paused" | "done";
      targetDate: string | null;
    }>;
    tasks: Array<{
      id: string;
      projectId: string;
      title: string;
      status: "backlog" | "todo" | "in_progress" | "in_review" | "done";
      priority: "urgent" | "high" | "medium" | "low";
      assigneeId: string | null;
      teamId: string | null;
      createdAt: string;
      updatedAt: string;
      dueDate: string | null;
    }>;
    users: Array<{ id: string; name: string; teamIds: string[]; active: boolean }>;
    sprints: Array<{
      id: string;
      projectId: string;
      name: string;
      status: "planned" | "active" | "done";
      startDate: string;
      endDate: string;
    }>;
    theme?: "light" | "dark";
  }

  export function mount(element: HTMLElement, props: InsightsRemoteProps): () => void;
}
