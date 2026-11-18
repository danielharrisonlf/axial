import { roleSchema } from "@axial/contracts";
import { z } from "zod";
import { ApiError, type HttpClient, isUnavailable, type TokenSource } from "./http";

/**
 * Browser session of the Workspace (ms-identity through the gateway).
 *
 * - The access token (RS256, 300 s) lives only in memory, never in storage.
 * - The session itself is the HttpOnly cookie `kairos_session` (Path=/api/v1/auth), set by
 *   login, signup and invitation acceptance; `POST auth/session` exchanges it for a new access
 *   token 60 s before expiry and on a 401 (single flight: concurrent callers share one request).
 * - The chosen organization id (not a secret) is kept in localStorage so a reload asks
 *   `auth/session` for the same organization with `X-Organization-Id`.
 * - A BroadcastChannel keeps tabs in step: logout and organization switches are mirrored.
 */

export const accessClaimsSchema = z.object({
  sub: z.string().min(1),
  organizationId: z.string().min(1),
  role: roleSchema,
  teamIds: z.array(z.string()).default([]),
  projectIds: z.array(z.string()).default([]),
  assignableUserIds: z.array(z.string()).default([]),
  assignableTeamIds: z.array(z.string()).default([]),
  exp: z.number(),
  source: z.string().optional(),
  purpose: z.string().optional(),
});
export type AccessClaims = z.infer<typeof accessClaimsSchema>;

/** Reads the claims of an access token for the interface only; the services verify the signature. */
export function decodeClaims(token: string): AccessClaims {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Token de acesso inválido");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return accessClaimsSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

const organizationChoiceSchema = z.object({ id: z.string(), name: z.string(), role: roleSchema });
export type OrganizationChoice = z.infer<typeof organizationChoiceSchema>;
const grantSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().positive(),
  requiresPasswordChange: z.boolean().optional(),
});
const loginResultSchema = z.union([
  z.object({ requiresOrganization: z.literal(true), organizations: z.array(organizationChoiceSchema) }),
  grantSchema,
]);
export const invitationPreviewSchema = z.object({
  organizationName: z.string(),
  email: z.string(),
  role: roleSchema,
  expiresAt: z.string(),
  existingAccount: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export type AuthState =
  | { kind: "restoring" }
  /** The identity service could not be reached while restoring the session. */
  | { kind: "unavailable" }
  | { kind: "signedOut"; notice: string | null }
  | { kind: "chooseOrganization"; organizations: OrganizationChoice[] }
  | { kind: "passwordChange"; email: string }
  | { kind: "signedIn"; organizationId: string; claims: AccessClaims };

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ChannelMessage = { type: "logout" } | { type: "organization"; organizationId: string };
interface ChannelPort {
  postMessage(message: ChannelMessage): void;
  onmessage: ((event: MessageEvent<ChannelMessage>) => void) | null;
  close(): void;
}

export const ORGANIZATION_KEY = "kairos.organization";
export const SESSION_EXPIRED = "Sua sessão expirou. Entre novamente.";
const REFRESH_MARGIN_SECONDS = 60;
const RETRY_SECONDS = 15;

export interface AuthSession extends TokenSource {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  chooseOrganization(organizationId: string): Promise<void>;
  signup(input: { name: string; email: string; password: string; organizationName: string }): Promise<void>;
  previewInvitation(token: string): Promise<InvitationPreview>;
  /** `email` is the invitation's (from the preview), used if the account must change its password. */
  acceptInvitation(token: string, input: { name?: string; password: string }, email: string): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  switchOrganization(organizationId: string): Promise<void>;
  logout(): Promise<void>;
  dispose(): void;
}

export function createAuthSession(options: {
  /** A client without a token source: auth routes carry their own credentials. */
  http: HttpClient;
  storage?: StoragePort;
  channel?: ChannelPort | null;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): AuthSession {
  const { http, storage } = options;
  const channel = options.channel ?? null;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let state: AuthState = { kind: "restoring" };
  let accessToken: string | null = null;
  /** Temporary token of a forced password change (purpose=password_change); only for auth/password. */
  let passwordToken: string | null = null;
  let timer: unknown = null;
  let inflight: Promise<string | null> | null = null;
  const listeners = new Set<() => void>();

  const setState = (next: AuthState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const storedOrganization = () => {
    try {
      return storage?.getItem(ORGANIZATION_KEY) ?? null;
    } catch {
      return null; // storage blocked: the session still works, a reload asks for the organization again
    }
  };
  const storeOrganization = (id: string | null) => {
    try {
      if (id) storage?.setItem(ORGANIZATION_KEY, id);
      else storage?.removeItem(ORGANIZATION_KEY);
    } catch {
      // storage blocked: only the convenience of reopening the same organization is lost
    }
  };
  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = (seconds: number) => {
    cancelTimer();
    timer = setTimer(() => {
      timer = null;
      refresh().catch((error: unknown) => {
        // unreachable service: the current token may still be valid; try again shortly
        if (isUnavailable(error)) schedule(RETRY_SECONDS);
      });
    }, Math.max(5, seconds) * 1000);
  };
  const signOut = (notice: string | null) => {
    cancelTimer();
    accessToken = null;
    passwordToken = null;
    setState({ kind: "signedOut", notice });
  };
  /** Accepts an operational access token and enters (or stays in) the organization it names. */
  const accept = (grant: { accessToken: string; expiresIn: number }) => {
    const claims = decodeClaims(grant.accessToken);
    accessToken = grant.accessToken;
    passwordToken = null;
    storeOrganization(claims.organizationId);
    schedule(grant.expiresIn - REFRESH_MARGIN_SECONDS);
    setState({ kind: "signedIn", organizationId: claims.organizationId, claims });
    return claims;
  };
  const handleLogin = (raw: unknown, email: string) => {
    const result = loginResultSchema.parse(raw);
    if ("requiresOrganization" in result) {
      accessToken = null;
      setState({ kind: "chooseOrganization", organizations: result.organizations });
      return;
    }
    if (result.requiresPasswordChange) {
      cancelTimer();
      accessToken = null;
      passwordToken = result.accessToken;
      setState({ kind: "passwordChange", email });
      return;
    }
    const claims = accept(result);
    channel?.postMessage({ type: "organization", organizationId: claims.organizationId });
  };
  /** POST auth/session with the cookie; null when the session is over (401). */
  const exchange = async (organizationId: string | null) => {
    try {
      const raw = await http.request<unknown>("/auth/session", {
        method: "POST",
        auth: false,
        credentials: true,
        headers: organizationId ? { "x-organization-id": organizationId } : undefined,
      });
      return grantSchema.parse(raw);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
      throw error;
    }
  };
  const refresh = (): Promise<string | null> => {
    if (inflight) return inflight;
    const organizationId = state.kind === "signedIn" ? state.organizationId : storedOrganization();
    inflight = (async () => {
      try {
        const grant = await exchange(organizationId);
        if (!grant) {
          if (state.kind === "signedIn") signOut(SESSION_EXPIRED);
          return null;
        }
        accept(grant);
        return grant.accessToken;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
  const restore = async () => {
    setState({ kind: "restoring" });
    try {
      const grant = await exchange(storedOrganization());
      if (grant) accept(grant);
      else signOut(null);
    } catch (error) {
      if (isUnavailable(error)) setState({ kind: "unavailable" });
      else throw error;
    }
  };

  if (channel)
    channel.onmessage = (event) => {
      const message = event.data;
      if (message.type === "logout") {
        if (state.kind !== "signedOut") signOut("Você saiu em outra aba.");
        return;
      }
      if (state.kind === "signedIn" && state.organizationId === message.organizationId) return;
      if (state.kind === "signedIn" || state.kind === "signedOut") {
        // another tab entered or switched organization: follow it with this tab's cookie session
        storeOrganization(message.organizationId);
        void restore().catch(() => signOut(null));
      }
    };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    token: () => accessToken,
    refresh,
    expired() {
      if (state.kind === "signedIn") signOut(SESSION_EXPIRED);
    },
    restore,
    async login(email, password) {
      const raw = await http.request<unknown>("/auth/login", {
        method: "POST",
        auth: false,
        credentials: true,
        body: { email, password },
      });
      handleLogin(raw, email);
    },
    async chooseOrganization(organizationId) {
      const grant = await exchange(organizationId);
      if (!grant) {
        signOut(SESSION_EXPIRED);
        return;
      }
      accept(grant);
      channel?.postMessage({ type: "organization", organizationId });
    },
    async signup(input) {
      const raw = await http.request<unknown>("/auth/signup", {
        method: "POST",
        auth: false,
        credentials: true,
        body: input,
      });
      handleLogin(raw, input.email);
    },
    async previewInvitation(token) {
      const raw = await http.request<unknown>(`/invitations/token/${encodeURIComponent(token)}`, {
        auth: false,
      });
      return invitationPreviewSchema.parse(raw);
    },
    async acceptInvitation(token, input, email) {
      const raw = await http.request<unknown>(`/invitations/token/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        auth: false,
        credentials: true,
        body: input,
      });
      handleLogin(raw, email);
    },
    async changePassword(currentPassword, newPassword) {
      if (state.kind !== "passwordChange" || !passwordToken) throw new Error("Troca de senha não solicitada");
      const email = state.email;
      await http.request("/auth/password", {
        method: "POST",
        auth: false,
        headers: { authorization: `Bearer ${passwordToken}` },
        body: { currentPassword, newPassword },
      });
      // the change ends every session of the account: enter again with the new password
      passwordToken = null;
      const raw = await http.request<unknown>("/auth/login", {
        method: "POST",
        auth: false,
        credentials: true,
        body: { email, password: newPassword },
      });
      handleLogin(raw, email);
    },
    async switchOrganization(organizationId) {
      const grant = await exchange(organizationId);
      if (!grant) {
        signOut(SESSION_EXPIRED);
        return;
      }
      accept(grant);
      channel?.postMessage({ type: "organization", organizationId });
    },
    async logout() {
      channel?.postMessage({ type: "logout" });
      try {
        await http.request("/auth/logout", { method: "POST", auth: false, credentials: true });
      } finally {
        storeOrganization(null);
        signOut(null);
      }
    },
    dispose() {
      cancelTimer();
      channel?.close();
      listeners.clear();
    },
  };
}
