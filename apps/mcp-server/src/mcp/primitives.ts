import { applyDecorators, UseFilters, UseGuards, UseInterceptors } from "@nestjs/common";
import { McpCallLogInterceptor } from "./call-log.interceptor.js";
import { McpErrorFilter } from "./errors.filter.js";
import { StdioScopeGuard } from "./scope.guard.js";

/**
 * Applied to every class that declares MCP primitives: the stdio scope check, the call log and the error
 * mapping. Scoped to these classes so the HTTP health controller keeps Nest's defaults.
 */
export function McpPrimitives(): ClassDecorator {
  return applyDecorators(
    UseGuards(StdioScopeGuard),
    UseInterceptors(McpCallLogInterceptor),
    UseFilters(McpErrorFilter),
  );
}
