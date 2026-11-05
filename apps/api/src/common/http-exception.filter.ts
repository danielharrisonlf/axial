import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { ZodError } from "zod";

interface ErrorResponse {
  status(status: number): ErrorResponse;
  json(body: unknown): void;
}
interface ErrorRequest {
  correlationId?: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<ErrorRequest>();
    let status = 500;
    let message = "Internal server error";
    let issues: unknown;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body: unknown = exception.getResponse();
      message = typeof body === "string" ? body : exception.message;
      if (typeof body === "object" && body !== null) {
        const response = body as Record<string, unknown>;
        if (typeof response.message === "string") message = response.message;
        else if (Array.isArray(response.message)) message = "Validation failed";
        issues = response.issues;
      }
    } else if (exception instanceof ZodError) {
      status = 400;
      message = "Validation failed";
      issues = exception.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    } else if (
      typeof exception === "object" &&
      exception !== null &&
      "type" in exception &&
      (exception.type === "entity.parse.failed" || exception.type === "entity.too.large")
    ) {
      status = exception.type === "entity.too.large" ? 413 : 400;
      message = status === 413 ? "Request body exceeds 256kb" : "Malformed JSON request body";
    } else if (typeof exception === "object" && exception !== null && "code" in exception) {
      if (exception.code === "P2002") {
        status = 409;
        message = "Resource already exists";
      }
      if (exception.code === "P2025") {
        status = 404;
        message = "Resource not found";
      }
    }
    if (status >= 500)
      this.logger.error(
        JSON.stringify({
          message: "request_failed",
          correlationId: request.correlationId,
          errorType: exception instanceof Error ? exception.name : "UnknownError",
        }),
      );
    context
      .getResponse<ErrorResponse>()
      .status(status)
      .json({
        statusCode: status,
        message,
        ...(issues === undefined ? {} : { issues }),
        correlationId: request.correlationId,
      });
  }
}
