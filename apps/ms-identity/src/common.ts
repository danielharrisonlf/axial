import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

export const roles = z.enum(["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "CONTRIBUTOR", "VIEWER"]);
export type Role = z.infer<typeof roles>;
export const uuid = z.uuid();
export const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
/** Passwords set by an administrator or changed by the user. */
export const password = z.string().min(14).max(128);
/** Passwords chosen by the user on self-service signup or invitation acceptance. */
export const chosenPassword = z.string().min(10).max(128);
export const name = z.string().trim().min(1).max(120);
export const title = z.string().trim().min(1).max(120);
export const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new BadRequestException("Invalid request");
  return result.data;
}

export function pathUuid(id: string): string {
  return parse(uuid, id);
}

export function isDuplicateEmail(error: unknown): boolean {
  const status = (error as { status?: string } | null)?.status;
  const message = (error as { body?: { message?: string }; message?: string } | null)?.body?.message ?? "";
  return (
    status === "CONFLICT" || status === "UNPROCESSABLE_ENTITY" || /already exists|user already/i.test(message)
  );
}

/** PostgreSQL unique_violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

export type Source = "api" | "ui" | "mcp" | "automation";

export interface Actor {
  userId: string;
  organizationId: string;
  role: Role;
  source: Source;
}

export interface Membership {
  role: Role;
  must_change_password: boolean;
}

/** Login, signup and invitation acceptance answer with tokens for one organization... */
export interface TokenGrant {
  accessToken: string;
  expiresIn: number;
  requiresPasswordChange: boolean;
  sessionToken: string;
}

/** ...or, for an account in several organizations, with the choice and no access token. */
export interface OrganizationChoice {
  requiresOrganization: true;
  organizations: { id: string; name: string; role: Role }[];
  sessionToken: string;
}

export type LoginResult = TokenGrant | OrganizationChoice;
