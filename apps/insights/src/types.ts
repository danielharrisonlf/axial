export type InsightPriority = "urgent" | "high" | "medium" | "low";
export type InsightStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
export type InsightRole = "admin" | "pm" | "lead" | "dev" | "viewer";
/** Page rendered by the remote; the Workspace shell owns the navigation between them. */
export type InsightsView = "executive" | "analytics" | "audit";

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
  /** Light-palette hex kept by the data; the interface maps it to a themed --cat-N token. */
  color: string;
}

export interface InsightTask {
  id: string;
  ref: string;
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
  /** Moment the task entered "done" (null while open). Completion metrics use it, never updatedAt. */
  doneAt: string | null;
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
  orgId: string;
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

export interface InsightRoleName {
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

/**
 * Module Federation contract. The host already scopes every collection to the
 * signed-in profile; the remote only filters inside that scope.
 */
export interface InsightsProps {
  view: InsightsView;
  projects: InsightProject[];
  tasks: InsightTask[];
  users: InsightUser[];
  teams: InsightTeam[];
  sprints: InsightSprint[];
  orgs: InsightOrganization[];
  audit: InsightAudit[];
  roleId: InsightRole;
  canAudit: boolean;
  /** Current profile; a change resets the filters, as the prototype does on profile switch. */
  meId: string;
  roles: InsightRoleName[];
  /** Opens the task inspector of the Workspace; without it task references are plain text. */
  openTask?: (taskId: string) => void;
}

export const EMPTY_PROPS: InsightsProps = {
  view: "executive",
  projects: [],
  tasks: [],
  users: [],
  teams: [],
  sprints: [],
  orgs: [],
  audit: [],
  roleId: "viewer",
  canAudit: false,
  meId: "",
  roles: [],
};
