import { describe, expect, it } from "vitest";
import { buildList, buildWhere, canReadAudit, canReadProject } from "../src/query.js";

const org = "de305d54-75b4-431b-adb2-eb6b9e546014";
const project = "de305d54-75b4-431b-adb2-eb6b9e546015";
const other = "de305d54-75b4-431b-adb2-eb6b9e546016";

describe("audit visibility", () => {
  it("only lets administration and delivery leadership read the audit trail", () => {
    expect(canReadAudit("ADMIN")).toBe(true);
    expect(canReadAudit("PROJECT_MANAGER")).toBe(true);
    expect(canReadAudit("TEAM_LEAD")).toBe(true);
    expect(canReadAudit("CONTRIBUTOR")).toBe(false);
    expect(canReadAudit("VIEWER")).toBe(false);
  });

  it("scopes non-administrators to their assigned projects", () => {
    const scope = { organizationId: org, role: "TEAM_LEAD" as const, projectIds: [project] };
    expect(canReadProject(scope, project)).toBe(true);
    expect(canReadProject(scope, other)).toBe(false);
    expect(canReadProject(scope, undefined)).toBe(false);
    expect(canReadProject({ organizationId: org, role: "ADMIN", projectIds: [] }, undefined)).toBe(true);
  });

  it("adds no project restriction for administrators", () => {
    const { where, values } = buildWhere({ organizationId: org, role: "ADMIN", projectIds: [] }, {});
    expect(where).toBe("WHERE organization_id=$1");
    expect(values).toEqual([org]);
  });

  it("restricts non-administrators and denies empty assignments", () => {
    expect(buildWhere({ organizationId: org, role: "PROJECT_MANAGER", projectIds: [project] }, {})).toEqual({
      where: "WHERE organization_id=$1 AND project_id = ANY($2::uuid[])",
      values: [org, [project]],
    });
    expect(buildWhere({ organizationId: org, role: "TEAM_LEAD", projectIds: [] }, {}).where).toBe(
      "WHERE organization_id=$1 AND FALSE",
    );
  });

  it("keeps every filter parameterized and paginates deterministically", () => {
    const query = buildList(
      { organizationId: org, role: "ADMIN", projectIds: [] },
      {
        projectId: project,
        actorId: other,
        eventType: "task.completed",
        aggregateType: "task",
        from: "2026-11-01T00:00:00.000Z",
        to: "2026-11-30T23:59:59.000Z",
        search: "task_%",
        page: 3,
        pageSize: 25,
      },
    );
    expect(query.where).toContain("project_id=$2");
    expect(query.where).toContain("actor_id=$3");
    expect(query.where).toContain("event_type=$4");
    expect(query.where).toContain("aggregate_type=$5");
    expect(query.where).toContain("occurred_at>=$6");
    expect(query.where).toContain("occurred_at<=$7");
    expect(query.where).toContain("ILIKE $8 ESCAPE");
    expect(query.values.at(-2)).toBe(25);
    expect(query.values.at(-1)).toBe(50);
    expect(query.limit).toBe(9);
    expect(query.offset).toBe(10);
  });
});
