import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { type McpContextType, McpExecutionContext, McpRegistry } from "@nestjs/mcp";
import { CallerIdentity } from "../identity.js";

/**
 * Over HTTP the module checks each primitive's `scopes` against the verified token before the method runs
 * (403 insufficient_scope). Over stdio it does not, so this guard applies the same rule to the stdio token:
 * one authorization model for both transports.
 */
@Injectable()
export class StdioScopeGuard implements CanActivate {
  constructor(
    @Inject(McpRegistry) private readonly registry: McpRegistry,
    @Inject(CallerIdentity) private readonly identity: CallerIdentity,
  ) {}

  private requiredScopes(kind: string | undefined, name: string | undefined): string[] {
    if (kind === "tool")
      return this.registry.tools.find((entry) => entry.name === name)?.options.scopes ?? [];
    if (kind === "prompt")
      return this.registry.prompts.find((entry) => entry.name === name)?.options.scopes ?? [];
    const resource =
      this.registry.resources.find((entry) => entry.name === name) ??
      this.registry.resourceTemplates.find((entry) => entry.name === name);
    return resource?.options.scopes ?? [];
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<McpContextType>() !== "mcp") return true;
    const mcp = McpExecutionContext.create(context);
    const ctx = mcp.getContext();
    if (ctx.transport !== "stdio") return true;
    const { scopes } = await this.identity.resolve(ctx);
    const missing = this.requiredScopes(mcp.getKind(), mcp.getName()).filter(
      (scope) => !scopes.includes(scope),
    );
    if (missing.length)
      throw new ForbiddenException(
        `Insufficient scope: the access token lacks ${missing.join(", ")}. Issue a token that grants it`,
      );
    return true;
  }
}
