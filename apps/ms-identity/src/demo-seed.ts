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
  /** Rows written by this run; zero everywhere on a repeated run. */
  inserted: IdentitySeedCounts;
  /** Rows of the scenario present after the run. */
  present: IdentitySeedCounts;
}

/** Credential row id of a seeded user, deterministic like every other seeded id. */
export const demoAccountId = (legacyUserId: string) => demoId(`account:${legacyUserId}`);

/**
 * Writes the directory of the demonstration scenario into the identity schema, insert only and
 * idempotent by deterministic id (`ON CONFLICT DO NOTHING`), in one transaction: organizations,
 * BetterAuth users with a verified e-mail and a credential account (password hashed by
 * BetterAuth), members with their title, teams with description and lead, team members and
 * project assignments. Existing rows are never updated: a repeated run keeps passwords, roles and
 * names as they are. Only accounts still missing get a hash, so a repeated run hashes nothing.
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
    await assertNoForeignAccounts(client, directory);
    const inserted = await insertDirectory(client, directory, password);
    const present = await countPresent(client, directory);
    for (const key of Object.keys(present) as (keyof IdentitySeedCounts)[])
      if (present[key] !== expected(directory)[key])
        throw new Error(`Identity demo seed left ${present[key]} of ${expected(directory)[key]} ${key}`);
    await client.query("COMMIT");
    return { inserted, present };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

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

/** A scenario e-mail already used by another account would leave the seeded user out. */
async function assertNoForeignAccounts(client: PoolClient, directory: IdentityDirectory): Promise<void> {
  const taken = await client.query<{ id: string; email: string }>(
    'SELECT id, email FROM identity."user" WHERE email = ANY($1::text[])',
    [directory.users.map((user) => user.email)],
  );
  const conflicts = taken.rows.filter(
    (row) => directory.users.find((user) => user.email === row.email)?.id !== row.id,
  );
  if (conflicts.length)
    throw new Error(
      `Demo e-mails already belong to other accounts: ${conflicts.map((row) => row.email).join(", ")}`,
    );
}

async function insertDirectory(
  client: PoolClient,
  directory: IdentityDirectory,
  password: string,
): Promise<IdentitySeedCounts> {
  const inserted: IdentitySeedCounts = {
    organizations: 0,
    users: 0,
    accounts: 0,
    members: 0,
    teams: 0,
    teamMembers: 0,
    projectAssignments: 0,
  };
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

async function countPresent(client: PoolClient, directory: IdentityDirectory): Promise<IdentitySeedCounts> {
  const count = async (sql: string, values: unknown[]) =>
    Number((await client.query<{ count: string }>(sql, values)).rows[0]?.count ?? 0);
  const pairs = <T>(items: readonly T[], ...fields: ((item: T) => string)[]) =>
    fields.map((field) => items.map(field));
  return {
    organizations: await count("SELECT count(*) FROM identity.organizations WHERE id = ANY($1::uuid[])", [
      directory.organizations.map((org) => org.id),
    ]),
    users: await count(
      `SELECT count(*) FROM identity."user" u
         JOIN unnest($1::uuid[], $2::text[]) AS s(id, email) ON s.id = u.id AND s.email = u.email`,
      pairs(
        directory.users,
        (user) => user.id,
        (user) => user.email,
      ),
    ),
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
