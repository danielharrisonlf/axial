import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Role } from "./common.js";
import { type ActorOptions, IdentityService } from "./identity.service.js";
import type { OAuthScope } from "./oauth.js";
import { db } from "./runtime.js";

const directoryScope: OAuthScope = "projects:read";
/**
 * Tokens delegated to MCP clients may read the directory with projects:read: the MCP server
 * resolves user ids to names with it. Nothing on this controller changes data.
 */
const directoryAccess: ActorOptions = { delegatedScope: directoryScope };

/**
 * Organization directory readable by every active member: people and teams of the
 * organization in the caller's token. Management stays in the administrator routes.
 */
@Controller("organization")
export class DirectoryController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @Get("members") async members(@Req() req: Request) {
    const actor = await this.identity.actor(req, directoryAccess);
    const result = await db.query<{
      id: string;
      name: string;
      email: string;
      title: string | null;
      role: Role;
      active: boolean;
      teamIds: string[];
    }>(
      `SELECT u.id, u.name, u.email, m.title, m.role, m.active,
              COALESCE(array_agg(tm.team_id ORDER BY tm.team_id) FILTER (WHERE tm.team_id IS NOT NULL), '{}') AS "teamIds"
         FROM identity.members m
         JOIN identity."user" u ON u.id = m.user_id
         LEFT JOIN identity.team_members tm ON tm.organization_id = m.organization_id AND tm.user_id = m.user_id
        WHERE m.organization_id = $1
        GROUP BY u.id, u.name, u.email, m.title, m.role, m.active
        ORDER BY u.name, u.email`,
      [actor.organizationId],
    );
    return result.rows;
  }

  @Get("teams") async teams(@Req() req: Request) {
    const actor = await this.identity.actor(req, directoryAccess);
    const result = await db.query<{
      id: string;
      name: string;
      description: string | null;
      leadUserId: string | null;
      memberIds: string[];
      active: boolean;
    }>(
      `SELECT t.id, t.name, t.description, t.lead_user_id AS "leadUserId",
              COALESCE(array_agg(tm.user_id ORDER BY tm.user_id) FILTER (WHERE tm.user_id IS NOT NULL), '{}') AS "memberIds",
              t.active
         FROM identity.teams t
         LEFT JOIN identity.team_members tm ON tm.organization_id = t.organization_id AND tm.team_id = t.id
        WHERE t.organization_id = $1
        GROUP BY t.id, t.name, t.description, t.lead_user_id, t.active
        ORDER BY t.name, t.id`,
      [actor.organizationId],
    );
    return result.rows;
  }
}
