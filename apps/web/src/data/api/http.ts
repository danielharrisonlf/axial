/**
 * HTTP client of the Workspace API mode. Every call goes through the gateway under `/api/v1`;
 * the access token travels only in memory (Authorization header). A 401 triggers one
 * single-flight refresh and one retry; a second 401 ends the session.
 */

/** Public origin of the gateway; empty means the same origin (the Vite dev/preview proxy). */
export function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

/** An HTTP failure. `status` 0 is a network failure (service unreachable). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The service could not answer: network failure, gateway or upstream error. */
export const isUnavailable = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 0 || error.status >= 500);

export interface TokenSource {
  /** Current access token, if any. */
  token(): string | null;
  /** Obtains a new access token (single-flight); null when the session is over. */
  refresh(): Promise<string | null>;
  /** Called when the session cannot be renewed (second 401). */
  expired(): void;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Sends the access token and applies the 401 refresh/retry rule (default true). */
  auth?: boolean;
  /** Sends cookies (the session cookie of /api/v1/auth). */
  credentials?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface HttpClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  readonly baseUrl: string;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

function messageOf(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string" && record.message) return record.message;
    if (typeof record.error === "string" && record.error) return record.error;
  }
  return fallback;
}

export function createHttpClient(options: {
  baseUrl?: string;
  fetch?: Fetch;
  tokens?: TokenSource;
}): HttpClient {
  const baseUrl = options.baseUrl ?? apiBaseUrl();
  const doFetch: Fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const url = (path: string, query: RequestOptions["query"]) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {}))
      if (value !== undefined && value !== null) search.set(key, String(value));
    const qs = search.toString();
    return `${baseUrl}/api/v1${path}${qs ? `?${qs}` : ""}`;
  };
  const send = async (path: string, request: RequestOptions, token: string | null) => {
    const headers: Record<string, string> = { accept: "application/json", ...request.headers };
    if (request.body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      return await doFetch(url(path, request.query), {
        method: request.method ?? "GET",
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        credentials: request.credentials ? "include" : "omit",
        signal: request.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, "Serviço indisponível");
    }
  };
  const parse = async <T>(response: Response): Promise<T> => {
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) throw new ApiError(response.status, messageOf(body, response.statusText), body);
    return body as T;
  };
  return {
    baseUrl,
    async request<T>(path: string, request: RequestOptions = {}): Promise<T> {
      const auth = request.auth ?? true;
      const tokens = options.tokens;
      if (!auth || !tokens) return parse<T>(await send(path, request, null));
      const first = await send(path, request, tokens.token());
      if (first.status !== 401) return parse<T>(first);
      const fresh = await tokens.refresh();
      if (!fresh) {
        tokens.expired();
        return parse<T>(first);
      }
      const second = await send(path, request, fresh);
      if (second.status === 401) tokens.expired();
      return parse<T>(second);
    },
  };
}

/** Reads every page of a `{ items, total, page, pageSize }` list (pages after the first in parallel). */
export async function fetchAllPages<T>(
  load: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>,
  pageSize = 100,
  maxPages = 50,
): Promise<T[]> {
  const first = await load(1, pageSize);
  const pages = Math.ceil(first.total / pageSize);
  // never a silently truncated list: the Workspace keeps the whole organization in memory
  if (pages > maxPages) throw new Error(`Lista grande demais para carregar (${first.total} itens).`);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, index) => load(index + 2, pageSize)),
  );
  return [...first.items, ...rest.flatMap((page) => page.items)];
}
