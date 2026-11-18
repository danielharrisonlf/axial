export const READ_SCOPE = "projects:read";
export const WRITE_SCOPE = "projects:write";
export const SUPPORTED_SCOPES = [READ_SCOPE, WRITE_SCOPE];

/**
 * Scopes of a verified identity token. Tokens issued through OAuth to an MCP client carry
 * a `scope` claim and must name this server as an audience (RFC 8707); they get only the
 * scopes they were granted. First-party tokens without `scope` (Workspace sessions, the
 * development token script) keep full access, as before OAuth existed.
 * Returns undefined when a delegated token was issued for another resource.
 */
export function grantedScopes(payload: { scope?: string; aud?: string | string[] }, resource: string) {
  if (payload.scope === undefined) return [...SUPPORTED_SCOPES];
  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audiences.includes(resource)) return undefined;
  const granted = new Set(payload.scope.split(" "));
  return SUPPORTED_SCOPES.filter((scope) => granted.has(scope));
}
