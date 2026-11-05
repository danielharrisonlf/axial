import { randomUUID } from "node:crypto";
import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { AuthenticatedRequest } from "./auth/current-actor.decorator.js";

interface Request extends AuthenticatedRequest {
  method: string;
  originalUrl?: string;
  url: string;
}
interface Response {
  statusCode: number;
  setHeader(name: string, value: string): void;
  on(event: "finish", callback: () => void): void;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger("Http");

  use(request: Request, response: Response, next: () => void): void {
    const incoming = request.headers["x-correlation-id"];
    request.correlationId =
      typeof incoming === "string" && /^[a-zA-Z0-9._-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    response.setHeader("x-correlation-id", request.correlationId);
    const started = Date.now();
    response.on("finish", () =>
      this.logger.log(
        JSON.stringify({
          message: "http_request",
          method: request.method,
          path: (request.originalUrl ?? request.url).split("?")[0],
          status: response.statusCode,
          durationMs: Date.now() - started,
          correlationId: request.correlationId,
        }),
      ),
    );
    next();
  }
}
