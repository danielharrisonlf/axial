export type InsightPriority = "urgent" | "high" | "medium" | "low";
export type InsightStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";

export interface InsightProject {
  id: string;
  name: string;
  key: string;
  status: "active" | "paused" | "done";
  targetDate: string | null;
}

export interface InsightTask {
  id: string;
  projectId: string;
  title: string;
  status: InsightStatus;
  priority: InsightPriority;
  assigneeId: string | null;
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
}

export interface InsightUser {
  id: string;
  name: string;
  teamIds: string[];
  active: boolean;
}

export interface InsightSprint {
  id: string;
  projectId: string;
  name: string;
  status: "planned" | "active" | "done";
  startDate: string;
  endDate: string;
}

export interface InsightsProps {
  projects: InsightProject[];
  tasks: InsightTask[];
  users: InsightUser[];
  sprints: InsightSprint[];
  theme?: "light" | "dark";
}

export const EMPTY_PROPS: InsightsProps = { projects: [], tasks: [], users: [], sprints: [] };

export type InsightsData = InsightsProps & Record<string, unknown>;
