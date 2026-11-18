import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { McpContext } from "@nestjs/mcp";
import { type McpConfig, readConfig } from "./config.js";
import { CallerIdentity } from "./identity.js";

export type UpstreamService = "projects" | "audit" | "notifications" | "identity";

const SERVICE_LABEL: Record<UpstreamService, string> = {
  projects: "Projects API",
  audit: "Audit API",
  notifications: "Notifications API",
  identity: "Identity API",
};

export function queryString(input: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined && value !== null) query.set(key, String(value));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

/** Only short, human-readable upstream text is passed on; stacks, SQL or long payloads never are. */
function safeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > 300) return undefined;
  return text;
}

function upstreamMessage(body: unknown): { message?: string; correlationId?: string; issues?: string } {
  if (typeof body !== "object" || body === null) return {};
  const record = body as Record<string, unknown>;
  const issues = Array.isArray(record.issues)
    ? record.issues
        .slice(0, 5)
        .map((issue) => {
          if (typeof issue !== "object" || issue === null) return undefined;
          const { path, message } = issue as { path?: unknown; message?: unknown };
          const text = safeText(message);
          if (!text) return undefined;
          return typeof path === "string" && path ? `${path}: ${text}` : text;
        })
        .filter((issue): issue is string => issue !== undefined)
        .join("; ")
    : undefined;
  const correlation = safeText(record.correlationId);
  return {
    message: safeText(record.message),
    correlationId: correlation && /^[A-Za-z0-9._:-]{1,128}$/.test(correlation) ? correlation : undefined,
    issues: issues || undefined,
  };
}

/**
 * Maps an upstream HTTP failure to an exception whose message is written for the model: what happened and
 * what to do next. 5xx bodies are never forwarded.
 */
export function upstreamError(
  status: number,
  body: unknown,
  service: UpstreamService = "projects",
): HttpException {
  const label = SERVICE_LABEL[service];
  const { message, correlationId, issues } = upstreamMessage(body);
  const reference = correlationId ? ` (correlation id ${correlationId})` : "";
  switch (status) {
    case 400:
      return new BadRequestException(
        `Invalid request: ${message ?? "the upstream service rejected the arguments"}${issues ? ` — ${issues}` : ""}${reference}`,
      );
    case 401:
      return new UnauthorizedException(
        `The access token was rejected by the ${label} (expired or revoked); sign in again to get a new token${reference}`,
      );
    case 403:
      return new ForbiddenException(
        `Forbidden: ${message ?? "the caller's role or project access does not allow this operation"}. Do not retry with other ids; ask a user with the right role${reference}`,
      );
    case 404:
      return new NotFoundException(
        `Not found: the resource does not exist or is outside the caller's organization or projects${reference}`,
      );
    case 409:
      return new ConflictException(
        `Conflict: ${message ?? "the resource changed or is in a state that does not allow this"}. Read the resource again to get its current version and state, check the change still makes sense, then retry with that version${reference}`,
      );
    case 429:
      return new HttpException(`Too many requests to the ${label}; wait before retrying${reference}`, 429);
    case 503:
      return new ServiceUnavailableException(`${label} unavailable; try again later${reference}`);
    default:
      if (status >= 500) return new BadGatewayException(`${label} unavailable; try again later${reference}`);
      return new HttpException(`${label} request failed${message ? `: ${message}` : ""}${reference}`, status);
  }
}

export interface UpstreamRequest {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

/**
 * Calls the Axial services with the caller's own bearer token. The MCP server holds no credentials of its
 * own: organization, role and project scope are decided upstream from that signed token.
 */
@Injectable()
export class AxialApi {
  private readonly config: McpConfig = readConfig();

  constructor(@Inject(CallerIdentity) private readonly identity: CallerIdentity) {}

  private baseUrl(service: UpstreamService): string {
    switch (service) {
      case "projects":
        return this.config.PROJECTS_API_URL;
      case "audit":
        return this.config.AUDIT_API_URL;
      case "notifications":
        return this.config.NOTIFICATIONS_API_URL;
      case "identity":
        return this.config.IDENTITY_API_URL;
    }
  }

  async request<T = unknown>(
    ctx: McpContext,
    service: UpstreamService,
    path: string,
    { method = "GET", query, body }: UpstreamRequest = {},
  ): Promise<T> {
    const { token } = await this.identity.resolve(ctx);
    const url = `${this.baseUrl(service)}/api/v1${path}${query ? queryString(query) : ""}`;
    const timeout = AbortSignal.timeout(this.config.MCP_UPSTREAM_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: "error",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(compact(body)) } : {}),
        signal: AbortSignal.any([ctx.signal, timeout]),
      });
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      if (timeout.aborted)
        throw new GatewayTimeoutException(`${SERVICE_LABEL[service]} did not answer in time; try again`);
      throw new ServiceUnavailableException(`${SERVICE_LABEL[service]} unreachable; try again later`);
    }
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (response.ok)
          throw new BadGatewayException(`${SERVICE_LABEL[service]} returned an unreadable response`);
      }
    }
    if (!response.ok) throw upstreamError(response.status, parsed, service);
    return parsed as T;
  }

  get<T = unknown>(ctx: McpContext, service: UpstreamService, path: string, query?: Record<string, unknown>) {
    return this.request<T>(ctx, service, path, { query });
  }

  /** Reads every page of a paginated `{items,total}` list, up to `limit` items. */
  async collect<T>(
    ctx: McpContext,
    path: string,
    query: Record<string, unknown> = {},
    limit = 500,
  ): Promise<{ items: T[]; total: number; truncated: boolean }> {
    const items: T[] = [];
    let total = 0;
    for (let page = 1; items.length < limit; page++) {
      const result = await this.get<Page<T>>(ctx, "projects", path, { ...query, page, pageSize: 100 });
      total = result.total;
      items.push(...result.items);
      if (result.items.length === 0 || items.length >= result.total) break;
    }
    return { items: items.slice(0, limit), total, truncated: total > Math.min(items.length, limit) };
  }
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
