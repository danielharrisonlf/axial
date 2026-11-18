import {
  type CallToolResult,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
} from "@modelcontextprotocol/server";
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import { type McpContextType, McpExecutionContext } from "@nestjs/mcp";

const TITLES: Record<number, string> = {
  400: "Invalid request",
  401: "Unauthenticated",
  403: "Forbidden",
  404: "Not found",
  409: "Conflict",
  429: "Rate limited",
  502: "Upstream unavailable",
  503: "Upstream unavailable",
  504: "Upstream timeout",
};

export function errorText(error: HttpException): string {
  const status = error.getStatus();
  const title = TITLES[status] ?? "Request failed";
  const message = error.message.startsWith(`${title}:`)
    ? error.message.slice(title.length + 1).trim()
    : error.message;
  return `${title} [${status}]: ${message}`;
}

/**
 * Turns HTTP-style failures (upstream answers, validation, confirmation) into what an agent can act on:
 * a tool result with `isError: true` and the status in `_meta`, or the matching JSON-RPC error for
 * resources and prompts. Other errors reach the module, which answers "Internal server error" and logs them.
 */
@Catch(HttpException)
export class McpErrorFilter implements ExceptionFilter {
  catch(error: HttpException, host: ArgumentsHost): CallToolResult {
    if (host.getType<McpContextType>() !== "mcp") throw error;
    const ctx = McpExecutionContext.create(host).getContext();
    const status = error.getStatus();
    const text = errorText(error);
    if (ctx.kind === "tool")
      return { content: [{ type: "text", text }], isError: true, _meta: { "axial/status": status } };
    if (status === 404 && ctx.kind === "resource" && ctx.uri)
      throw new ResourceNotFoundError(ctx.uri.href, text);
    const code =
      status === 400 || status === 404
        ? ProtocolErrorCode.InvalidParams
        : status >= 500
          ? ProtocolErrorCode.InternalError
          : ProtocolErrorCode.InvalidRequest;
    throw new ProtocolError(code, text, { status });
  }
}
