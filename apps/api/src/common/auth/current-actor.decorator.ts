import type { AuthContext } from "@axial/contracts";
import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  actor?: AuthContext;
  correlationId?: string;
}

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext | undefined => {
    return context.switchToHttp().getRequest<AuthenticatedRequest>().actor;
  },
);
