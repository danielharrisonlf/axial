import { isInputRequiredResult } from "@modelcontextprotocol/server";
import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import { type McpContextType, McpExecutionContext } from "@nestjs/mcp";
import { catchError, type Observable, tap, throwError } from "rxjs";
import type { VerifiedIdentity } from "../verifier.js";

/**
 * One structured log line per MCP call: primitive, caller, transport/era, duration and outcome. Arguments and
 * results are not logged (they may hold task content). Over stdio the logger writes to stderr.
 */
@Injectable()
export class McpCallLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger("McpCalls");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<McpContextType>() !== "mcp") return next.handle();
    const ctx = McpExecutionContext.create(context).getContext();
    const identity = (ctx.authInfo?.extra as { identity?: VerifiedIdentity } | undefined)?.identity;
    const started = performance.now();
    const entry = (outcome: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        message: "mcp_call",
        kind: ctx.kind,
        name: ctx.uri?.href ?? ctx.name,
        userId: identity?.userId,
        organizationId: identity?.organizationId,
        transport: ctx.transport,
        era: ctx.era,
        durationMs: Math.round(performance.now() - started),
        outcome,
        ...extra,
      });
    return next.handle().pipe(
      tap((value) => {
        if (isInputRequiredResult(value)) this.logger.log(entry("input_required"));
        else if ((value as { isError?: unknown } | undefined)?.isError === true)
          this.logger.warn(entry("tool_error"));
        else this.logger.log(entry("ok"));
      }),
      catchError((error: unknown) => {
        const status = error instanceof HttpException ? error.getStatus() : 500;
        if (status >= 500) this.logger.error(entry("failed", { status }));
        else this.logger.warn(entry("failed", { status }));
        return throwError(() => error);
      }),
    );
  }
}
