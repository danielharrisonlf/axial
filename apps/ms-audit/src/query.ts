import type { Role } from "@axial/contracts";

export interface AuditScope {
  organizationId: string;
  role: Role;
  /** Projects the caller is assigned to. Ignored for ADMIN. */
  projectIds: string[];
}

export interface AuditFilter {
  projectId?: string;
  actorId?: string;
  eventType?: string;
  aggregateType?: string;
  from?: string;
  to?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export interface QueryPart {
  where: string;
  values: unknown[];
}

const scopedRoles = new Set<Role>(["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD"]);

export function canReadAudit(role: Role): boolean {
  return scopedRoles.has(role);
}

export function canReadProject(scope: AuditScope, projectId: string | undefined): boolean {
  if (scope.role === "ADMIN") return true;
  return projectId !== undefined && scope.projectIds.includes(projectId);
}

/** Builds the shared WHERE clause. Values are positional and never interpolated. */
export function buildWhere(scope: AuditScope, filter: Omit<AuditFilter, "page" | "pageSize">): QueryPart {
  const values: unknown[] = [scope.organizationId];
  const clauses = ["organization_id=$1"];
  if (scope.role !== "ADMIN") {
    if (!scope.projectIds.length) clauses.push("FALSE");
    else {
      values.push(scope.projectIds);
      clauses.push(`project_id = ANY($${values.length}::uuid[])`);
    }
  }
  if (filter.projectId) {
    values.push(filter.projectId);
    clauses.push(`project_id=$${values.length}`);
  }
  if (filter.actorId) {
    values.push(filter.actorId);
    clauses.push(`actor_id=$${values.length}`);
  }
  if (filter.eventType) {
    values.push(filter.eventType);
    clauses.push(`event_type=$${values.length}`);
  }
  if (filter.aggregateType) {
    values.push(filter.aggregateType);
    clauses.push(`aggregate_type=$${values.length}`);
  }
  if (filter.from) {
    values.push(filter.from);
    clauses.push(`occurred_at>=$${values.length}`);
  }
  if (filter.to) {
    values.push(filter.to);
    clauses.push(`occurred_at<=$${values.length}`);
  }
  if (filter.search) {
    values.push(`%${filter.search.replace(/[\\%_]/g, "\\$&")}%`);
    clauses.push(
      `(event_type ILIKE $${values.length} ESCAPE '\\' OR aggregate_type ILIKE $${values.length} ESCAPE '\\' OR aggregate_id::text ILIKE $${values.length} ESCAPE '\\')`,
    );
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, values };
}

export interface ListQuery extends QueryPart {
  limit: number;
  offset: number;
}

export function buildList(scope: AuditScope, filter: AuditFilter): ListQuery {
  const { where, values } = buildWhere(scope, filter);
  return {
    where,
    values: [...values, filter.pageSize, (filter.page - 1) * filter.pageSize],
    limit: values.length + 1,
    offset: values.length + 2,
  };
}

export function buildCount(scope: AuditScope, filter: AuditFilter): QueryPart {
  return buildWhere(scope, filter);
}
