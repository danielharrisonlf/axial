import {
  type DemoMembership,
  type DemoOrganization,
  type DemoProjectAssignment,
  type DemoTeam,
  type DemoTeamMembership,
  type DemoUser,
  demoId,
} from "@axial/demo-fixtures";
import { hashPassword } from "better-auth/crypto";
import type { Pool, PoolClient } from "pg";

/** The date independent part of the scenario that ms-identity owns. */
export interface IdentityDirectory {
  organizations: readonly DemoOrganization[];
  users: readonly DemoUser[];
  teams: readonly DemoTeam[];
  memberships: readonly DemoMembership[];
  teamMemberships: readonly DemoTeamMembership[];
  projectAssignments: readonly DemoProjectAssignment[];
}

export interface IdentitySeedCounts {
  organizations: number;
  users: number;
  accounts: number;
  members: number;
  teams: number;
  teamMembers: number;
  projectAssignments: number;
}
export interface IdentitySeedReport {
  /**
   * `seeded` on the first run; `already seeded` once the demo organizations exist, and then
   * nothing is written: rows changed or removed since the first run stay as they are.
   */
  status: "seeded" | "already seeded";
  /** Rows written by this run; zero everywhere on a repeated run. */
  inserted: IdentitySeedCounts;
  /** Rows of the scenario present after the run, counted by primary key. */
  present: IdentitySeedCounts;
  /** Divergences from the scenario (skipped users, changed or removed rows); never fatal. */
  warnings: string[];
}

/** Credential row id of a seeded user, deterministic like every other seeded id. */
export const demoAccountId = (legacyUserId: string) => demoId(`account:${legacyUserId}`);

/**
 * Writes the directory of the demonstration scenario into the identity schema on the first run
 * only, in one transaction under an advisory lock: organizations, BetterAuth users with a verified
 * e-mail and a credential account (password hashed by BetterAuth), members with their title, teams
 * with description and lead, team members and project assignments. Once the demo organizations
 * exist the run writes nothing, so whatever people changed or removed afterwards (an e-mail, a
 * membership, a team member) is neither restored nor overwritten, and no password is hashed.
 * Divergences never fail the seed: a scenario e-mail that already belongs to another account
 * leaves that user out with the rows that depend on it, and rows missing or changed after the
 * run are reported in `warnings`. Database errors still fail it.
 * The outbox triggers of the domain tables record the inserted rows like any other write.
 */
export async function seedIdentity(
  pool: Pool,
  directory: IdentityDirectory,
  password: string,
): Promise<IdentitySeedReport> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('axial-identity-demo-seed'))");
    const organizations = await client.query<{ count: string }>(
      "SELECT count(*) FROM identity.organizations WHERE id = ANY($1::uuid[])",
      [directory.organizations.map((org) => org.id)],
    );
    const seeded = Number(organizations.rows[0]?.count ?? 0) > 0;
    const warnings: string[] = [];
    let written = directory;
    let inserted = emptyCounts();
    if (!seeded) {
      written = await withoutForeignAccounts(client, directory, warnings);
      inserted = await insertDirectory(client, written, password);
    }
    const present = await countPresent(client, directory);
    const want = expected(written);
    for (const key of Object.keys(present) as (keyof IdentitySeedCounts)[])
      if (present[key] < want[key])
        warnings.push(
          `${key}: ${present[key]} of ${want[key]} scenario rows present; missing rows are not restored`,
        );
    warnings.push(...(await changedUsers(client, directory)));
    await client.query("COMMIT");
    return { status: seeded ? "already seeded" : "seeded", inserted, present, warnings };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const emptyCounts = (): IdentitySeedCounts => ({
  organizations: 0,
  users: 0,
  accounts: 0,
  members: 0,
  teams: 0,
  teamMembers: 0,
  projectAssignments: 0,
});

function expected(directory: IdentityDirectory): IdentitySeedCounts {
  return {
    organizations: directory.organizations.length,
    users: directory.users.length,
    accounts: directory.users.length,
    members: directory.memberships.length,
    teams: directory.teams.length,
    teamMembers: directory.teamMemberships.length,
    projectAssignments: directory.projectAssignments.length,
  };
}

/**
 * A scenario e-mail already used by another account (another id) would make the user insert
 * collide: that user is left out with its memberships, team memberships and project assignments.
 * A team it leads is left out too (the lead must be a member), with its team memberships.
 */
async function withoutForeignAccounts(
  client: PoolClient,
  directory: IdentityDirectory,
  warnings: string[],
): Promise<IdentityDirectory> {
  const taken = await client.query<{ id: string; email: string }>(
    'SELECT id, email FROM identity."user" WHERE email = ANY($1::text[])',
    [directory.users.map((user) => user.email)],
  );
  const skippedUsers = new Set<string>();
  for (const row of taken.rows) {
    const user = directory.users.find((item) => item.email === row.email);
    if (user && user.id !== row.id) {
      skippedUsers.add(user.id);
      warnings.push(
        `user ${user.legacyId} (${user.id}) skipped: its e-mail already belongs to account ${row.id}; ` +
          "its memberships, team memberships and project assignments were not written",
      );
    }
  }
  if (!skippedUsers.size) return directory;
  const skippedTeams = new Set<string>();
  for (const team of directory.teams)
    if (skippedUsers.has(team.leadId)) {
      skippedTeams.add(team.id);
      warnings.push(`team ${team.legacyId} (${team.id}) skipped: its lead was skipped`);
    }
  return {
    organizations: directory.organizations,
    users: directory.users.filter((user) => !skippedUsers.has(user.id)),
    teams: directory.teams.filter((team) => !skippedTeams.has(team.id)),
    memberships: directory.memberships.filter((item) => !skippedUsers.has(item.userId)),
    teamMemberships: directory.teamMemberships.filter(
      (item) => !skippedUsers.has(item.userId) && !skippedTeams.has(item.teamId),
    ),
    projectAssignments: directory.projectAssignments.filter((item) => !skippedUsers.has(item.userId)),
  };
}

/** Seeded users whose e-mail or name no longer match the scenario (edited after the first run). */
async function changedUsers(client: PoolClient, directory: IdentityDirectory): Promise<string[]> {
  const rows = await client.query<{ id: string; email: string; name: string }>(
    'SELECT id, email, name FROM identity."user" WHERE id = ANY($1::uuid[])',
    [directory.users.map((user) => user.id)],
  );
  return rows.rows.flatMap((row) => {
    const user = directory.users.find((item) => item.id === row.id);
    if (!user) return [];
    const fields = [
      ...(row.email === user.email ? [] : ["e-mail"]),
      ...(row.name === user.name ? [] : ["name"]),
    ];
    return fields.length
      ? [`user ${user.legacyId} (${user.id}) differs from the scenario (${fields.join(", ")}); kept as is`]
      : [];
  });
}

async function insertDirectory(
  client: PoolClient,
  directory: IdentityDirectory,
  password: string,
): Promise<IdentitySeedCounts> {
  const inserted = emptyCounts();
  const insert = async (key: keyof IdentitySeedCounts, sql: string, values: unknown[]) => {
    inserted[key] += (await client.query(sql, values)).rowCount ?? 0;
  };
  for (const org of directory.organizations)
    await insert(
      "organizations",
      "INSERT INTO identity.organizations(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [org.id, org.name],
    );
  for (const user of directory.users)
    await insert(
      "users",
      `INSERT INTO identity."user"(id,email,name,"emailVerified","mustChangePassword")
       VALUES($1,$2,$3,true,false) ON CONFLICT DO NOTHING`,
      [user.id, user.email, user.name],
    );
  const credentials = await client.query<{ userId: string }>(
    `SELECT "userId" FROM identity.account WHERE "providerId"='credential' AND "userId" = ANY($1::uuid[])`,
    [directory.users.map((user) => user.id)],
  );
  const withCredential = new Set(credentials.rows.map((row) => row.userId));
  const missing = directory.users.filter((user) => !withCredential.has(user.id));
  // Each account gets its own salted hash, as when BetterAuth creates it.
  for (const user of missing)
    await insert(
      "accounts",
      `INSERT INTO identity.account(id,"providerId","accountId","userId",password)
       VALUES($1,'credential',$2::text,$2::uuid,$3) ON CONFLICT DO NOTHING`,
      [demoAccountId(user.legacyId), user.id, await hashPassword(password)],
    );
  const titles = new Map(directory.users.map((user) => [user.id, user.title]));
  const active = new Map(directory.users.map((user) => [user.id, user.active]));
  for (const member of directory.memberships)
    await insert(
      "members",
      `INSERT INTO identity.members(organization_id,user_id,role,title,active)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [
        member.organizationId,
        member.userId,
        member.role,
        titles.get(member.userId) ?? null,
        active.get(member.userId) ?? true,
      ],
    );
  for (const team of directory.teams)
    await insert(
      "teams",
      `INSERT INTO identity.teams(organization_id,id,name,description,lead_user_id)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [team.organizationId, team.id, team.name, team.description, team.leadId],
    );
  for (const member of directory.teamMemberships)
    await insert(
      "teamMembers",
      "INSERT INTO identity.team_members(organization_id,team_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [member.organizationId, member.teamId, member.userId],
    );
  for (const assignment of directory.projectAssignments)
    await insert(
      "projectAssignments",
      "INSERT INTO identity.project_assignments(organization_id,user_id,project_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [assignment.organizationId, assignment.userId, assignment.projectId],
    );
  return inserted;
}

/** Scenario rows present, each counted by its primary key alone (column values may have changed). */
async function countPresent(client: PoolClient, directory: IdentityDirectory): Promise<IdentitySeedCounts> {
  const count = async (sql: string, values: unknown[]) =>
    Number((await client.query<{ count: string }>(sql, values)).rows[0]?.count ?? 0);
  const pairs = <T>(items: readonly T[], ...fields: ((item: T) => string)[]) =>
    fields.map((field) => items.map(field));
  return {
    organizations: await count("SELECT count(*) FROM identity.organizations WHERE id = ANY($1::uuid[])", [
      directory.organizations.map((org) => org.id),
    ]),
    users: await count('SELECT count(*) FROM identity."user" WHERE id = ANY($1::uuid[])', [
      directory.users.map((user) => user.id),
    ]),
    accounts: await count(
      `SELECT count(*) FROM identity.account WHERE "providerId"='credential' AND "userId" = ANY($1::uuid[])`,
      [directory.users.map((user) => user.id)],
    ),
    members: await count(
      `SELECT count(*) FROM identity.members m
         JOIN unnest($1::uuid[], $2::uuid[]) AS s(organization_id, user_id)
           ON s.organization_id = m.organization_id AND s.user_id = m.user_id`,
      pairs(
        directory.memberships,
        (item) => item.organizationId,
        (item) => item.userId,
      ),
    ),
    teams: await count(
      `SELECT count(*) FROM identity.teams t
         JOIN unnest($1::uuid[], $2::uuid[]) AS s(organization_id, id)
           ON s.organization_id = t.organization_id AND s.id = t.id`,
      pairs(
        directory.teams,
        (item) => item.organizationId,
        (item) => item.id,
      ),
    ),
    teamMembers: await count(
      `SELECT count(*) FROM identity.team_members tm
         JOIN unnest($1::uuid[], $2::uuid[], $3::uuid[]) AS s(organization_id, team_id, user_id)
           ON s.organization_id = tm.organization_id AND s.team_id = tm.team_id AND s.user_id = tm.user_id`,
      pairs(
        directory.teamMemberships,
        (item) => item.organizationId,
        (item) => item.teamId,
        (item) => item.userId,
      ),
    ),
    projectAssignments: await count(
      `SELECT count(*) FROM identity.project_assignments pa
         JOIN unnest($1::uuid[], $2::uuid[], $3::uuid[]) AS s(organization_id, user_id, project_id)
           ON s.organization_id = pa.organization_id AND s.user_id = pa.user_id AND s.project_id = pa.project_id`,
      pairs(
        directory.projectAssignments,
        (item) => item.organizationId,
        (item) => item.userId,
        (item) => item.projectId,
      ),
    ),
  };
}
