import type { Role } from "@axial/contracts";

/**
 * OAuth scopes of the Axial MCP resource server. A scope is a ceiling for what the agent may attempt; the
 * upstream service still decides with the caller's role, organization and project access.
 */
export const SCOPES = {
  projectsRead: "projects:read",
  projectsWrite: "projects:write",
  auditRead: "audit:read",
  notificationsRead: "notifications:read",
  notificationsWrite: "notifications:write",
  identityRead: "identity:read",
  identityWrite: "identity:write",
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];
export const ALL_SCOPES: Scope[] = Object.values(SCOPES);

const everyone: Scope[] = [SCOPES.projectsRead, SCOPES.notificationsRead, SCOPES.notificationsWrite];
const members: Scope[] = [...everyone, SCOPES.projectsWrite];
const supervisors: Scope[] = [...members, SCOPES.auditRead];

/** The most a token of each role can carry, mirroring what the upstream services accept for that role. */
export const ROLE_SCOPES: Record<Role, Scope[]> = {
  ADMIN: ALL_SCOPES,
  PROJECT_MANAGER: supervisors,
  TEAM_LEAD: supervisors,
  CONTRIBUTOR: members,
  VIEWER: everyone,
};

/**
 * Scopes granted to a verified token: the role ceiling, narrowed by the token's own `scope` claim when the
 * issuer set one (space-delimited, RFC 8693 style). A `scope` claim never widens what the role allows.
 */
export function grantedScopes(role: Role, scopeClaim: string | undefined): Scope[] {
  const ceiling = ROLE_SCOPES[role];
  if (scopeClaim === undefined) return [...ceiling];
  const requested = new Set(scopeClaim.split(/\s+/).filter(Boolean));
  return ceiling.filter((scope) => requested.has(scope));
}
