import { describe, expect, it } from "vitest";
import type { Role } from "./index.js";
import {
  canArchiveProject,
  canAssign,
  canAssignTeams,
  canChangeProjectMembership,
  canComment,
  canCreateProject,
  canCreateTask,
  canDeleteTask,
  canEditTaskFields,
  canManageProject,
  canModifyComment,
  canReadProject,
  contributorTaskFields,
  editableTaskFields,
  isManager,
  type PolicyActor,
} from "./policy.js";

const me = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const myTeam = "00000000-0000-4000-8000-0000000000a1";
const otherTeam = "00000000-0000-4000-8000-0000000000a2";
const project = { id: "00000000-0000-4000-8000-0000000000b1", teamIds: [myTeam] };
const foreignProject = { id: "00000000-0000-4000-8000-0000000000c1", teamIds: [otherTeam] };
const roles: Role[] = ["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"];
const actor = (role: Role, overrides: Partial<PolicyActor> = {}): PolicyActor => ({
  userId: me,
  role,
  teamIds: [myTeam],
  projectIds: [],
  assignableUserIds: [other],
  assignableTeamIds: [myTeam],
  ...overrides,
});
const matrix = (check: (role: Role) => boolean) =>
  Object.fromEntries(roles.map((role) => [role, check(role)]));

describe("shared ms-projects authorization policy", () => {
  it("grants organization-wide reading and project administration only to managers", () => {
    expect(matrix((role) => isManager(actor(role)))).toEqual({
      ADMIN: true,
      PROJECT_MANAGER: true,
      TEAM_LEAD: false,
      CONTRIBUTOR: false,
      VIEWER: false,
    });
    for (const role of roles) {
      const manager = role === "ADMIN" || role === "PROJECT_MANAGER";
      expect(canCreateProject(actor(role))).toBe(manager);
      expect(canArchiveProject(actor(role))).toBe(manager);
      expect(canChangeProjectMembership(actor(role))).toBe(manager);
      expect(canReadProject(actor(role), foreignProject)).toBe(manager);
      expect(canReadProject(actor(role), project)).toBe(true);
      expect(
        canReadProject(actor(role, { teamIds: [], projectIds: [foreignProject.id] }), foreignProject),
      ).toBe(true);
    }
  });

  it("lets team leads manage only projects that include one of their teams", () => {
    expect(matrix((role) => canManageProject(actor(role), project))).toEqual({
      ADMIN: true,
      PROJECT_MANAGER: true,
      TEAM_LEAD: true,
      CONTRIBUTOR: false,
      VIEWER: false,
    });
    expect(matrix((role) => canManageProject(actor(role), foreignProject))).toEqual({
      ADMIN: true,
      PROJECT_MANAGER: true,
      TEAM_LEAD: false,
      CONTRIBUTOR: false,
      VIEWER: false,
    });
  });

  it("requires team leads to create and delete tasks inside their own teams", () => {
    expect(matrix((role) => canCreateTask(actor(role), project, myTeam))).toEqual({
      ADMIN: true,
      PROJECT_MANAGER: true,
      TEAM_LEAD: true,
      CONTRIBUTOR: false,
      VIEWER: false,
    });
    expect(canCreateTask(actor("TEAM_LEAD"), project, null)).toBe(false);
    expect(canCreateTask(actor("TEAM_LEAD"), project, otherTeam)).toBe(false);
    expect(canCreateTask(actor("PROJECT_MANAGER"), project, null)).toBe(true);
    const own = { teamId: myTeam, assigneeId: me };
    const foreign = { teamId: otherTeam, assigneeId: me };
    expect(matrix((role) => canDeleteTask(actor(role), project, own))).toEqual({
      ADMIN: true,
      PROJECT_MANAGER: true,
      TEAM_LEAD: true,
      CONTRIBUTOR: false,
      VIEWER: false,
    });
    expect(canDeleteTask(actor("TEAM_LEAD"), project, foreign)).toBe(false);
    expect(canDeleteTask(actor("TEAM_LEAD"), project, { teamId: null, assigneeId: null })).toBe(false);
  });

  it("limits contributors to content fields of their own assigned tasks and viewers to nothing", () => {
    const assigned = { teamId: otherTeam, assigneeId: me };
    const unassigned = { teamId: myTeam, assigneeId: other };
    expect(editableTaskFields(actor("ADMIN"), unassigned)).toBe("all");
    expect(editableTaskFields(actor("PROJECT_MANAGER"), unassigned)).toBe("all");
    expect(editableTaskFields(actor("TEAM_LEAD"), unassigned)).toBe("all");
    expect(editableTaskFields(actor("TEAM_LEAD"), assigned)).toEqual([]);
    expect(editableTaskFields(actor("CONTRIBUTOR"), assigned)).toEqual(contributorTaskFields);
    expect(editableTaskFields(actor("CONTRIBUTOR"), unassigned)).toEqual([]);
    expect(editableTaskFields(actor("VIEWER"), assigned)).toEqual([]);
    expect(
      canEditTaskFields(actor("CONTRIBUTOR"), assigned, ["version", "status", "acceptanceCriteria"]),
    ).toBe(true);
    expect(canEditTaskFields(actor("CONTRIBUTOR"), assigned, ["version", "assigneeId"])).toBe(false);
    expect(canEditTaskFields(actor("CONTRIBUTOR"), assigned, ["version", "position"])).toBe(false);
    expect(canEditTaskFields(actor("CONTRIBUTOR"), unassigned, ["version", "title"])).toBe(false);
    expect(canEditTaskFields(actor("VIEWER"), assigned, ["version"])).toBe(false);
    expect(canEditTaskFields(actor("TEAM_LEAD"), unassigned, ["sprintId"])).toBe(true);
  });

  it("validates assignable users and teams from the signed token", () => {
    const contributor = actor("CONTRIBUTOR");
    expect(canAssign(contributor, null)).toBe(true);
    expect(canAssign(contributor, undefined)).toBe(true);
    expect(canAssign(contributor, me)).toBe(true);
    expect(canAssign(contributor, other)).toBe(true);
    expect(canAssign(contributor, "00000000-0000-4000-8000-000000000009")).toBe(false);
    expect(canAssignTeams(contributor, undefined)).toBe(true);
    expect(canAssignTeams(contributor, [myTeam])).toBe(true);
    expect(canAssignTeams(contributor, [myTeam, otherTeam])).toBe(false);
  });

  it("lets every role but viewers comment and only authors or managers modify comments", () => {
    expect(matrix((role) => canComment(actor(role)))).toEqual({
      ADMIN: true,
      PROJECT_MANAGER: true,
      TEAM_LEAD: true,
      CONTRIBUTOR: true,
      VIEWER: false,
    });
    expect(matrix((role) => canModifyComment(actor(role), { authorId: other }))).toEqual({
      ADMIN: true,
      PROJECT_MANAGER: true,
      TEAM_LEAD: false,
      CONTRIBUTOR: false,
      VIEWER: false,
    });
    expect(matrix((role) => canModifyComment(actor(role), { authorId: me }))).toEqual({
      ADMIN: true,
      PROJECT_MANAGER: true,
      TEAM_LEAD: true,
      CONTRIBUTOR: true,
      VIEWER: false,
    });
  });
});
