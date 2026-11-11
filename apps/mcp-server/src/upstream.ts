import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

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

export function upstreamError(status: number, body: unknown): HttpException {
  const message =
    typeof body === "object" && body !== null && "message" in body
      ? String((body as { message: unknown }).message)
      : "Projects API request failed";
  switch (status) {
    case 400:
      return new BadRequestException(message);
    case 401:
      return new UnauthorizedException(message);
    case 403:
      return new ForbiddenException(message);
    case 404:
      return new NotFoundException(message);
    case 409:
      return new ConflictException(message);
    default:
      return status >= 500
        ? new BadGatewayException("Projects API unavailable")
        : new HttpException(message, status);
  }
}
