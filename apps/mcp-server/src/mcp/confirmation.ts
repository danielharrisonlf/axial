import {
  acceptedContent,
  CLIENT_CAPABILITIES_META_KEY,
  type InputRequiredResult,
  inputRequired,
  inputResponse,
} from "@modelcontextprotocol/server";
import { BadRequestException } from "@nestjs/common";
import type { McpContext } from "@nestjs/mcp";
import { z } from "zod";

const confirmation = z.object({
  confirm: z.boolean().describe("I confirm this operation"),
});

/**
 * Elicitation inside a call needs the 2026-07-28 multi-round-trip flow and a client that declared the
 * `elicitation` capability. 2025-era clients over stateless HTTP cannot be asked mid-call: they confirm with
 * an explicit `confirm: true` argument after asking the user themselves.
 */
export function canElicit(ctx: McpContext): boolean {
  if (ctx.era !== "modern") return false;
  const envelope = ctx.server.mcpReq.envelope as Record<string, unknown> | undefined;
  const capabilities = envelope?.[CLIENT_CAPABILITIES_META_KEY] as { elicitation?: unknown } | undefined;
  return capabilities?.elicitation !== undefined && capabilities.elicitation !== null;
}

export type Confirmation =
  | { status: "confirmed" }
  | { status: "declined"; message: string }
  | { status: "pending"; result: InputRequiredResult };

/**
 * Asks the user to confirm a destructive operation. The caller runs the operation only on `confirmed`,
 * returns `result` on `pending` (the client asks the user and calls again), and `message` on `declined`.
 * Without elicitation, `confirm: true` is required; otherwise a clear tool error explains what to do.
 */
export function requireConfirmation(
  ctx: McpContext,
  confirmArgument: boolean | undefined,
  question: string,
): Confirmation {
  if (canElicit(ctx)) {
    const responses = ctx.server.mcpReq.inputResponses;
    if (inputResponse(responses, "confirm").kind === "missing")
      return {
        status: "pending",
        result: inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({ message: question, requestedSchema: confirmation }),
          },
        }),
      };
    if (acceptedContent(responses, "confirm", confirmation)?.confirm === true) return { status: "confirmed" };
    return { status: "declined", message: "Cancelled by the user; nothing was changed." };
  }
  if (confirmArgument === true) return { status: "confirmed" };
  throw new BadRequestException(
    `Confirmation required: ${question} Ask the user to confirm explicitly, then call again with confirm: true.`,
  );
}
