import type { Role } from "@axial/contracts";
import { createContext, useContext } from "react";

/** Signed-in session controls for the shell (header user menu, stale-data banner). Null in the demo. */
export interface SessionControls {
  organizationId: string;
  memberships: { organizationId: string; organizationName: string; role: Role }[];
  switchOrganization(organizationId: string): void;
  logout(): void;
  /** Full reload of the organization's data (the "Serviço indisponível" banner retry). */
  reload(): void;
  /** JSON-RPC `tools/call` on the real MCP server with this session's access token. */
  callMcp(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Own notification channels (ms-notifications), read only. */
  notificationChannels(): Promise<
    { channel: string; enabled: boolean; destination: string | null; verified: boolean }[]
  >;
  /** Version of a loaded resource (optimistic concurrency), for the MCP console examples. */
  versionOf(id: string): number | undefined;
  /** Administration of members and invitations (ADMIN), through ms-identity. */
  admin: {
    setMemberActive(userId: string, active: boolean): Promise<void>;
    createInvitation(input: {
      email: string;
      role: Role;
      teamIds: string[];
      title?: string;
    }): Promise<{ id: string; url: string; expiresAt: string }>;
    listInvitations(): Promise<Invitation[]>;
    revokeInvitation(id: string): Promise<void>;
  };
}
export interface Invitation {
  id: string;
  email: string;
  role: Role;
  teamIds: string[];
  title: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
}
export const SessionContext = createContext<SessionControls | null>(null);
export const useSession = () => useContext(SessionContext);
