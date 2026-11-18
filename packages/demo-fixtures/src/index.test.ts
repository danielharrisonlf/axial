import { describe, expect, it } from "vitest";
import {
  ATLAS_ORGANIZATION_ID,
  buildDemoFixtures,
  calendarDay,
  claimsFor,
  DEMO_NAMESPACE,
  demoId,
  demoUser,
  legacySeed,
  localDay,
  memberships,
  organizations,
  projectAssignments,
  shift,
  users,
  VETOR_ORGANIZATION_ID,
  validateFixtures,
} from "./index.js";

const now = new Date("2026-11-18T15:00:00.000Z");

describe("demoId", () => {
  it("is a deterministic version 5 UUID per legacy id", () => {
    expect(demoId("u1")).toBe(demoId("u1"));
    expect(demoId("u1")).not.toBe(demoId("u2"));
    expect(demoId("u1")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(DEMO_NAMESPACE).toBe("6f1d2c3e-8a4b-5c6d-9e7f-0a1b2c3d4e5f");
  });

  it("keeps known ids stable so other seeds can rely on them", () => {
    expect(VETOR_ORGANIZATION_ID).toBe("e32ce341-02ee-536d-8553-81a6ecb39413");
    expect(demoUser("helena.costa@vetorlabs.dev").id).toBe(demoId("u1"));
  });
});

describe("dates", () => {
  it("renders date-only values as local day edges with the zone offset", () => {
    expect(localDay("2026-11-05")).toBe("2026-11-05T00:00:00.000-03:00");
    expect(localDay("2026-11-05", "America/Sao_Paulo", "end")).toBe("2026-11-05T23:59:59.999-03:00");
    expect(localDay("2026-07-01", "Europe/Lisbon")).toBe("2026-07-01T00:00:00.000+01:00");
    expect(localDay("2026-01-01", "UTC", "end")).toBe("2026-01-01T23:59:59.999+00:00");
  });

  it("uses the calendar day of the zone, not of UTC", () => {
    expect(calendarDay(new Date("2026-11-18T01:00:00.000Z"))).toBe("2026-11-17");
  });

  it("shifts like the web demo: whole days for dates, kept distance for instants, nothing in the future", () => {
    const shifted = shift(now);
    const original = legacySeed.sprints[0];
    const moved = shifted.sprints[0];
    expect(original && moved).toBeTruthy();
    // seeded on 2026-11-05 (local), shifted to 2026-11-18: 13 days
    expect(moved?.startDate).toBe("2026-10-21");
    expect(original?.startDate).toBe("2026-10-08");
    const instants = shifted.audit.map((entry) => Date.parse(entry.ts));
    expect(Math.max(...instants)).toBeLessThanOrEqual(now.getTime());
    const a = legacySeed.audit[0];
    const b = legacySeed.audit[1];
    const sa = shifted.audit[0];
    const sb = shifted.audit[1];
    if (!a || !b || !sa || !sb) throw new Error("missing audit entries");
    expect(Date.parse(sb.ts) - Date.parse(sa.ts)).toBe(Date.parse(b.ts) - Date.parse(a.ts));
  });
});

describe("directory", () => {
  it("maps prototype roles and keeps both fictional organizations", () => {
    expect(organizations.map((org) => org.name)).toEqual(["Vetor Labs", "Atlas Engenharia & Consultoria"]);
    expect(users).toHaveLength(18);
    const role = (email: string) => demoUser(email).role;
    expect(role("helena.costa@vetorlabs.dev")).toBe("ADMIN");
    expect(role("ricardo.nogueira@vetorlabs.dev")).toBe("PROJECT_MANAGER");
    expect(role("ana.souza@vetorlabs.dev")).toBe("TEAM_LEAD");
    expect(role("camila.freitas@vetorlabs.dev")).toBe("CONTRIBUTOR");
    expect(role("sergio.tavares@vetorlabs.dev")).toBe("VIEWER");
  });

  it("assigns the viewer to every Vetor project and leads to their projects", () => {
    const fixtures = buildDemoFixtures({ now });
    const vetorProjects = fixtures.projects.filter(
      (project) => project.organizationId === VETOR_ORGANIZATION_ID,
    );
    const sergio = claimsFor(demoUser("sergio.tavares@vetorlabs.dev").id);
    expect(sergio.projectIds).toEqual(vetorProjects.map((project) => project.id).sort());
    for (const project of fixtures.projects)
      expect(
        projectAssignments.some((entry) => entry.projectId === project.id && entry.userId === project.leadId),
      ).toBe(true);
    const ana = claimsFor(demoUser("ana.souza@vetorlabs.dev").id);
    const plataforma = demoId("tm-plat");
    expect(ana.teamIds).toEqual([plataforma]);
    for (const project of vetorProjects.filter((item) => item.teamIds.includes(plataforma)))
      expect(ana.projectIds).toContain(project.id);
    expect(ana.assignableUserIds).toHaveLength(16);
  });

  it("gives the administrator a membership in both organizations, the others only in their own", () => {
    const helena = demoUser("helena.costa@vetorlabs.dev");
    expect(
      memberships.filter((item) => item.userId === helena.id).map((item) => [item.organizationId, item.role]),
    ).toEqual([
      [VETOR_ORGANIZATION_ID, "ADMIN"],
      [ATLAS_ORGANIZATION_ID, "ADMIN"],
    ]);
    expect(memberships).toHaveLength(users.length + 1);
    expect(claimsFor(helena.id).organizationId).toBe(VETOR_ORGANIZATION_ID);
    const atlas = claimsFor(helena.id, ATLAS_ORGANIZATION_ID);
    expect(atlas).toMatchObject({ role: "ADMIN", teamIds: [], projectIds: [] });
    expect(atlas.assignableUserIds).toHaveLength(3);
    expect(() => claimsFor(demoUser("ricardo.nogueira@vetorlabs.dev").id, ATLAS_ORGANIZATION_ID)).toThrow(
      /not a member/,
    );
  });
});

describe("buildDemoFixtures", () => {
  const fixtures = buildDemoFixtures({ now });

  it("is consistent with the contracts and the ms-projects invariants", () => {
    expect(validateFixtures(fixtures)).toEqual([]);
  });

  it("keeps the scenario counts and references", () => {
    expect(fixtures.projects).toHaveLength(11);
    expect(fixtures.tasks).toHaveLength(109);
    expect(fixtures.epics).toHaveLength(14);
    expect(fixtures.sprints).toHaveLength(7);
    expect(fixtures.milestones).toHaveLength(10);
    expect(fixtures.comments).toHaveLength(33);
    expect(fixtures.auditEvents).toHaveLength(74);
    expect(fixtures.excluded.map((item) => item.legacyId)).toEqual(["cm12", "au69"]);
    const pcl = fixtures.projects.find((project) => project.key === "PCL");
    expect(pcl).toMatchObject({ taskSequence: 119, color: "#2B5FD9", status: "active" });
    const task = fixtures.tasks.find((item) => item.ref === "PCL-109");
    expect(task).toMatchObject({ number: 109, projectId: pcl?.id });
  });

  it("is deterministic for a given instant and keeps ids for another one", () => {
    expect(buildDemoFixtures({ now })).toEqual(fixtures);
    const later = buildDemoFixtures({ now: new Date("2027-01-10T12:00:00.000Z") });
    expect(later.tasks.map((task) => task.id)).toEqual(fixtures.tasks.map((task) => task.id));
    expect(later.tasks[0]?.createdAt).not.toBe(fixtures.tasks[0]?.createdAt);
  });

  it("maps audit entries to backend event types with remapped ids", () => {
    const types = new Set(fixtures.auditEvents.map((event) => event.type));
    expect([...types].sort()).toEqual([
      "project.created",
      "sprint.started",
      "task.assigned",
      "task.completed",
      "task.created",
      "task.status_changed",
    ]);
    const assigned = fixtures.auditEvents.find((event) => event.legacyId === "au19");
    expect(assigned?.data.after).toEqual({ assigneeId: demoId("u2") });
    expect(assigned?.actor).toEqual({ id: demoId("u2"), source: "ui" });
    for (const event of fixtures.auditEvents)
      expect(Date.parse(event.occurredAt)).toBeLessThanOrEqual(now.getTime());
  });

  it("reports broken references instead of hiding them", () => {
    const broken = structuredClone(fixtures);
    const [first, second] = broken.tasks;
    if (!first || !second) throw new Error("missing tasks");
    first.blockedByIds = [second.id];
    second.blockedByIds = [first.id];
    broken.sprints.forEach((sprint) => {
      if (sprint.projectId === first.projectId) sprint.status = "active";
    });
    const problems = validateFixtures(broken);
    expect(problems.some((problem) => problem.startsWith("dependency cycle"))).toBe(true);
    expect(problems.some((problem) => problem.includes("more than one active sprint"))).toBe(true);
  });
});
