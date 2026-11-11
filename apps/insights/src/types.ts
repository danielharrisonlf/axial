export type InsightPriority = "urgent" | "high" | "medium" | "low";
export type InsightStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
export type InsightRole = "admin" | "pm" | "lead" | "dev" | "viewer";

export interface InsightProject {
  id: string;
  orgId: string;
  name: string;
  key: string;
  status: "active" | "paused" | "done";
  targetDate: string | null;
  leadId: string;
  teamIds: string[];
  archived: boolean;
}

export interface InsightTask {
  id: string;
  projectId: string;
  title: string;
  status: InsightStatus;
  priority: InsightPriority;
  assigneeId: string | null;
  teamId: string | null;
  sprintId: string | null;
  parentId: string | null;
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
}

export interface InsightUser {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  teamIds: string[];
  roleId: InsightRole;
  active: boolean;
}

export interface InsightTeam {
  id: string;
  name: string;
  orgId: string;
}

export interface InsightSprint {
  id: string;
  projectId: string;
  name: string;
  status: "planned" | "active" | "done";
  startDate: string;
  endDate: string;
}

export interface InsightOrganization {
  id: string;
  name: string;
}

export interface InsightAudit {
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
}

export interface InsightsProps {
  projects: InsightProject[];
  tasks: InsightTask[];
  users: InsightUser[];
  teams: InsightTeam[];
  sprints: InsightSprint[];
  orgs: InsightOrganization[];
  audit: InsightAudit[];
  roleId: InsightRole;
  canAudit: boolean;
  theme?: "light" | "dark";
}

export const EMPTY_PROPS: InsightsProps = {
  projects: [],
  tasks: [],
  users: [],
  teams: [],
  sprints: [],
  orgs: [],
  audit: [],
  roleId: "viewer",
  canAudit: false,
};

export type InsightsData = InsightsProps & Record<string, unknown>;
