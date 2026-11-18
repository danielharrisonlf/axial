export const routeTable = [
  {
    name: "notifications",
    prefixes: ["/api/v1/notification-preferences"],
  },
  {
    name: "audit",
    prefixes: ["/api/v1/audit"],
  },
  {
    name: "identity",
    prefixes: [
      "/api/v1/auth",
      "/api/v1/me",
      "/api/v1/organization",
      "/api/v1/organizations",
      "/api/v1/members",
      "/api/v1/teams",
      // OAuth authorization server for MCP clients: issuer, endpoints and metadata.
      "/identity",
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration",
    ],
  },
  {
    name: "projects",
    prefixes: [
      "/api/v1/projects",
      "/api/v1/epics",
      "/api/v1/tasks",
      "/api/v1/sprints",
      "/api/v1/comments",
      "/api/v1/milestones",
    ],
  },
  {
    name: "mcp",
    // Protected resource metadata (RFC 9728) advertised by the 401 of /mcp.
    prefixes: ["/mcp", "/.well-known/oauth-protected-resource"],
  },
] as const;

export type RouteName = (typeof routeTable)[number]["name"];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Returns the upstream that owns a request path, or undefined for gateway-local routes. */
export function resolveRoute(pathname: string): RouteName | undefined {
  if (pathname === "/api/v1/health" || pathname.startsWith("/api/v1/health/")) return undefined;
  return routeTable.find((route) => route.prefixes.some((prefix) => matches(pathname, prefix)))?.name;
}
