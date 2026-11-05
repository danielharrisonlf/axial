export type Priority = "urgent" | "high" | "medium" | "low";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
export type RoleId = "admin" | "pm" | "lead" | "dev" | "viewer";
export type Theme = "light" | "dark" | "system";
export interface Organization {
  id: string;
  name: string;
  slug: string;
  desc: string;
  demo: boolean;
}
export interface Role {
  id: RoleId;
  name: string;
  desc: string;
}
export interface User {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  title: string;
  roleId: RoleId;
  orgId: string;
  teamIds: string[];
  active: boolean;
  invited?: boolean;
}
export interface Team {
  id: string;
  orgId: string;
  name: string;
  desc: string;
  leadId: string;
  memberIds: string[];
}
export interface Project {
  id: string;
  orgId: string;
  key: string;
  name: string;
  desc: string;
  teamIds: string[];
  leadId: string;
  priority: Priority;
  status: "active" | "paused" | "done";
  startDate: string;
  targetDate: string | null;
  favorite: boolean;
  archived: boolean;
  createdAt: string;
  color: string;
  progressNote?: string;
  age?: number;
}
export interface Epic {
  id: string;
  projectId: string;
  name: string;
  desc: string;
  status: string;
  ownerId: string;
}
export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  status: "planned" | "active" | "done";
  startDate: string;
  endDate: string;
}
export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  date: string;
  status: "open" | "done";
}
export interface AcceptanceCriterion {
  text: string;
  done: boolean;
}
export interface Task {
  id: string;
  ref: string;
  projectId: string;
  epicId: string | null;
  parentId: string | null;
  type: "task" | "bug" | "subtask";
  title: string;
  desc: string;
  status: TaskStatus;
  priority: Priority;
  assigneeId: string | null;
  teamId: string | null;
  sprintId: string | null;
  labels: string[];
  acceptance: AcceptanceCriterion[];
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  createdBy: string;
}
export interface Comment {
  id: string;
  taskId: string;
  userId: string;
  text: string;
  createdAt: string;
}
export interface AuditEntry {
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
export interface Notification {
  id: string;
  ts: string;
  channel: string;
  templateId: string;
  eventType: string;
  toUserId: string;
  subject: string;
  body: string;
  status: string;
  attempts: number;
}
export interface WorkspaceData {
  meta: { seedVersion: number; seededAt: string };
  settings: {
    theme: Theme;
    activeApp: string;
    currentUserId: string;
    currentProjectId: string;
    navCollapsed: boolean;
  };
  orgs: Organization[];
  roles: Role[];
  users: User[];
  teams: Team[];
  projects: Project[];
  epics: Epic[];
  sprints: Sprint[];
  milestones: Milestone[];
  tasks: Task[];
  comments: Comment[];
  audit: AuditEntry[];
  notifications: Notification[];
  taskCounters: Record<string, number>;
}
export type ProjectInput = Pick<Project, "key" | "name"> &
  Partial<Pick<Project, "desc" | "teamIds" | "leadId" | "priority" | "startDate" | "targetDate">>;
export type TaskInput = Pick<Task, "projectId" | "title"> &
  Partial<Omit<Task, "id" | "ref" | "projectId" | "title" | "createdAt" | "updatedAt" | "createdBy">> & {
    silent?: boolean;
  };
export type SprintInput = Pick<Sprint, "name" | "startDate" | "endDate"> & Partial<Pick<Sprint, "goal">>;
export type ToastTone = "ok" | "err" | "warn" | "info";
export interface Toast {
  id: string;
  title: string;
  message: string;
  tone: ToastTone;
}
