import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  type Actor,
  email,
  type LoginResult,
  name,
  PASSWORD_MAX_LENGTH,
  parse,
  password,
  pathUuid,
  type Role,
  roles,
  strict,
  title,
  uuid,
} from "./common.js";
import { deliverLogin, IdentityService, sourceOf } from "./identity.service.js";
import { hashToken, opaqueToken } from "./oauth.js";
import { db, settings, transaction } from "./runtime.js";
import { INVITATION_TTL_MS, invitationUrl } from "./settings.js";

/** Invitation tokens are 32 random bytes in base64url; only their SHA-256 hash is stored. */
const INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  teamIds: string[];
  title: string | null;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  createdBy: string;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

const notFound = () => new NotFoundException("Invitation not found");

function tokenHash(token: string): string {
  if (!INVITATION_TOKEN.test(token)) throw notFound();
  return hashToken(token);
}

/**
 * Administrators invite people by link. The link carries the only copy of the token; the
 * invited person sets a password for a new account, or proves the password of an existing
 * one, and joins the organization with the invited role, teams and title.
 */
@Injectable()
export class InvitationsService {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  async create(actor: Actor, data: unknown): Promise<{ id: string; url: string; expiresAt: Date }> {
    const input = parse(
      strict({
        email,
        role: roles,
        teamIds: z.array(uuid).max(50).optional(),
        title: title.optional(),
      }),
      data,
    );
    const teamIds = [...new Set(input.teamIds ?? [])];
    if (teamIds.length) {
      const teams = await db.query(
        "SELECT 1 FROM identity.teams WHERE organization_id=$1 AND id = ANY($2::uuid[]) AND active",
        [actor.organizationId, teamIds],
      );
      if (teams.rowCount !== teamIds.length) throw new BadRequestException("Unknown team");
    }
    const member = await db.query(
      `SELECT 1 FROM identity.members m JOIN identity."user" u ON u.id=m.user_id
        WHERE m.organization_id=$1 AND u.email=$2 AND m.active`,
      [actor.organizationId, input.email],
    );
    if (member.rowCount) throw new HttpException("Already a member", 409);
    const id = randomUUID();
    const token = opaqueToken();
    const created = await db.query<{ expires_at: Date }>(
      `INSERT INTO identity.invitations(id,organization_id,email,role,team_ids,title,token_hash,expires_at,created_by)
       VALUES($1,$2,$3,$4,$5::uuid[],$6,$7, now() + make_interval(secs => $8), $9)
       RETURNING expires_at`,
      [
        id,
        actor.organizationId,
        input.email,
        input.role,
        teamIds,
        input.title ?? null,
        hashToken(token),
        INVITATION_TTL_MS / 1000,
        actor.userId,
      ],
    );
    const expiresAt = created.rows[0]?.expires_at;
    if (!expiresAt) throw new Error("Invitation was not stored");
    return { id, url: invitationUrl(settings.IDENTITY_WEB_URL, token), expiresAt };
  }

  async list(actor: Actor): Promise<InvitationRow[]> {
    const result = await db.query<InvitationRow>(
      `SELECT id, email, role, team_ids AS "teamIds", title,
              CASE WHEN accepted_at IS NOT NULL THEN 'accepted'
                   WHEN revoked_at IS NOT NULL THEN 'revoked'
                   WHEN expires_at <= now() THEN 'expired'
                   ELSE 'pending' END AS status,
              expires_at AS "expiresAt", created_at AS "createdAt", created_by AS "createdBy",
              accepted_at AS "acceptedAt", revoked_at AS "revokedAt"
         FROM identity.invitations
        WHERE organization_id=$1
        ORDER BY created_at DESC, id
        LIMIT 500`,
      [actor.organizationId],
    );
    return result.rows;
  }

  async revoke(actor: Actor, rawId: string): Promise<{ id: string; status: "revoked" }> {
    const id = pathUuid(rawId);
    const revoked = await db.query(
      `UPDATE identity.invitations SET revoked_at=now()
        WHERE organization_id=$1 AND id=$2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [actor.organizationId, id],
    );
    if (!revoked.rowCount) {
      const current = await db.query<{ accepted: boolean }>(
        "SELECT accepted_at IS NOT NULL AS accepted FROM identity.invitations WHERE organization_id=$1 AND id=$2",
        [actor.organizationId, id],
      );
      const row = current.rows[0];
      if (!row) throw notFound();
      if (row.accepted) throw new HttpException("Invitation already accepted", 409);
    }
    return { id, status: "revoked" };
  }

  /** Public preview of a usable invitation; any other token is simply not found. */
  async preview(token: string) {
    const result = await db.query<{
      organizationName: string;
      email: string;
      role: Role;
      expiresAt: Date;
      existingAccount: boolean;
    }>(
      `SELECT o.name AS "organizationName", i.email, i.role, i.expires_at AS "expiresAt",
              EXISTS (SELECT 1 FROM identity."user" u WHERE u.email = i.email) AS "existingAccount"
         FROM identity.invitations i
         JOIN identity.organizations o ON o.id = i.organization_id
        WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
          AND i.expires_at > now() AND o.active`,
      [tokenHash(token)],
    );
    const row = result.rows[0];
    if (!row) throw notFound();
    return row;
  }

  async accept(req: Request, token: string, data: unknown): Promise<LoginResult> {
    const hash = tokenHash(token);
    const input = parse(
      strict({ name: name.optional(), password: z.string().min(1).max(PASSWORD_MAX_LENGTH) }),
      data,
    );
    const accepted = await transaction(async (client) => {
      const found = await client.query<{
        id: string;
        organization_id: string;
        email: string;
        role: Role;
        team_ids: string[];
        title: string | null;
      }>(
        `SELECT i.id, i.organization_id, i.email, i.role, i.team_ids, i.title
           FROM identity.invitations i
           JOIN identity.organizations o ON o.id = i.organization_id
          WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
            AND i.expires_at > now() AND o.active
          FOR UPDATE OF i`,
        [hash],
      );
      const invitation = found.rows[0];
      if (!invitation) throw notFound();
      const account = await client.query<{ id: string; password: string | null }>(
        `SELECT u.id, a.password FROM identity."user" u
           LEFT JOIN identity.account a ON a."userId"=u.id AND a."providerId"='credential'
          WHERE u.email=$1
          FOR UPDATE OF u`,
        [invitation.email],
      );
      const existing = account.rows[0];
      let userId: string;
      if (existing) {
        // An existing account joins only with its own password.
        if (
          !existing.password ||
          !(await verifyPassword({ hash: existing.password, password: input.password }))
        )
          throw new UnauthorizedException("Invalid credentials");
        userId = existing.id;
      } else {
        if (!password.safeParse(input.password).success) throw new BadRequestException("Invalid request");
        userId = randomUUID();
        await this.identity.createAccount(
          client,
          userId,
          invitation.email,
          input.name ?? invitation.email.split("@")[0] ?? invitation.email,
          await hashPassword(input.password),
        );
      }
      const membership = await client.query<{ active: boolean }>(
        "SELECT active FROM identity.members WHERE organization_id=$1 AND user_id=$2 FOR UPDATE",
        [invitation.organization_id, userId],
      );
      const current = membership.rows[0];
      if (current?.active) throw new HttpException("Already a member", 409);
      // A deactivated member comes back with the invited role and title.
      if (current)
        await client.query(
          "UPDATE identity.members SET role=$3, title=$4, active=true WHERE organization_id=$1 AND user_id=$2",
          [invitation.organization_id, userId, invitation.role, invitation.title],
        );
      else
        await client.query(
          "INSERT INTO identity.members(organization_id,user_id,role,title) VALUES($1,$2,$3,$4)",
          [invitation.organization_id, userId, invitation.role, invitation.title],
        );
      // Teams deactivated since the invitation are skipped.
      await client.query(
        `INSERT INTO identity.team_members(organization_id,team_id,user_id)
         SELECT organization_id, id, $3 FROM identity.teams
          WHERE organization_id=$1 AND id = ANY($2::uuid[]) AND active
         ON CONFLICT DO NOTHING`,
        [invitation.organization_id, invitation.team_ids, userId],
      );
      await client.query("UPDATE identity.invitations SET accepted_at=now() WHERE id=$1", [invitation.id]);
      return { userId, organizationId: invitation.organization_id, email: invitation.email };
    });
    const sessionToken = await this.identity.openSession(req, accepted.email, input.password);
    return this.identity.completeLogin(accepted.userId, sessionToken, accepted.organizationId, sourceOf(req));
  }
}

@Controller("invitations")
export class InvitationsController {
  constructor(
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  @Post() async create(@Req() req: Request, @Body() body: unknown) {
    const actor = await this.identity.actor(req, { admin: true });
    return this.invitations.create(actor, body);
  }

  @Get() async list(@Req() req: Request) {
    const actor = await this.identity.actor(req, { admin: true });
    return this.invitations.list(actor);
  }

  @Delete(":id") async revoke(@Req() req: Request, @Param("id") id: string) {
    const actor = await this.identity.actor(req, { admin: true });
    return this.invitations.revoke(actor, id);
  }

  @Get("token/:token") preview(@Req() req: Request, @Param("token") token: string) {
    return this.identity.limitAuthentication(req.ip ?? "unknown", "invitation", () =>
      this.invitations.preview(token),
    );
  }

  @Post("token/:token/accept") async accept(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("token") token: string,
    @Body() body: unknown,
  ) {
    const result = await this.identity.limitAuthentication(req.ip ?? "unknown", "invitation-accept", () =>
      this.invitations.accept(req, token, body),
    );
    return deliverLogin(req, res, result);
  }
}
