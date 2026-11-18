import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import App from "./App";
import {
  AuthLoading,
  InvitationScreen,
  LoginScreen,
  OrganizationPicker,
  PasswordChangeScreen,
  ServiceUnavailable,
  SignupScreen,
} from "./auth/AuthScreens";
import { type AccessClaims, type AuthSession, createAuthSession } from "./data/api/auth";
import { createHttpClient } from "./data/api/http";
import { callMcpTool } from "./data/api/mcp";
import { realtimeUrl, startRealtime } from "./data/api/realtime";
import { createApiStore } from "./data/api/store";
import { installWorkspaceStore } from "./data/workspace";
import { SessionContext, type SessionControls } from "./session";

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // blocked storage: only local preferences are lost
  }
}

/** One session per page: the auth client has no token source, the data client refreshes through it. */
const storage = browserStorage();
const auth: AuthSession = createAuthSession({
  http: createHttpClient({}),
  storage,
  channel: typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("kairos-auth"),
});
const http = createHttpClient({ tokens: auth });

const readInviteToken = () => /^#\/convite\/([^/?#]+)/.exec(window.location.hash)?.[1] ?? null;
function useInviteToken() {
  const [token, setToken] = useState(readInviteToken);
  useEffect(() => {
    const listener = () => setToken(readInviteToken());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  return token;
}

/** API mode root: authentication screens, then the Workspace of the chosen organization. */
export function ApiRoot() {
  const state = useSyncExternalStore(auth.subscribe, auth.getState, auth.getState);
  const invite = useInviteToken();
  const [signup, setSignup] = useState(false);
  useEffect(() => {
    auth.restore().catch(() => {
      // an unexpected answer (not 401 nor unreachable) leaves the person at the login screen
      auth.expired();
    });
  }, []);
  if (invite)
    return (
      <InvitationScreen
        auth={auth}
        token={invite}
        onDone={() => {
          window.location.hash = "#/dashboard";
        }}
      />
    );
  switch (state.kind) {
    case "restoring":
      return <AuthLoading />;
    case "unavailable":
      return <ServiceUnavailable onRetry={() => void auth.restore()} />;
    case "signedOut":
      return signup ? (
        <SignupScreen auth={auth} onLogin={() => setSignup(false)} />
      ) : (
        <LoginScreen auth={auth} notice={state.notice} onSignup={() => setSignup(true)} />
      );
    case "chooseOrganization":
      return <OrganizationPicker auth={auth} organizations={state.organizations} />;
    case "passwordChange":
      return <PasswordChangeScreen auth={auth} email={state.email} />;
    case "signedIn":
      return <SignedInWorkspace key={state.organizationId} organizationId={state.organizationId} />;
  }
}

function SignedInWorkspace({ organizationId }: { organizationId: string }) {
  // the store reads the latest claims (they change on every refresh) and keeps the last ones
  // during a sign-out transition, when in-flight requests may still settle
  const store = useMemo(() => {
    let last: AccessClaims | null = null;
    const claims = () => {
      const current = auth.getState();
      if (current.kind === "signedIn") last = current.claims;
      if (!last) throw new Error("Sessão encerrada");
      return last;
    };
    return createApiStore({ http, claims, storage });
  }, []);
  // idempotent; done in render (not in the memo) so StrictMode's double memo call cannot install a
  // store other than the one this component keeps
  installWorkspaceStore(store);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void attempt;
    let cancelled = false;
    setPhase("loading");
    store
      .load()
      .then(() => {
        if (!cancelled) setPhase("ready");
      })
      .catch(() => {
        if (!cancelled && auth.getState().kind === "signedIn") setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [store, attempt]);

  // realtime: one socket, subscribed to the open projects; an invalidation reads the project again
  useEffect(() => {
    if (phase !== "ready") return;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const projectIds = () => store.visibleProjects().map((project) => project.id);
    const realtime = startRealtime({
      url: realtimeUrl(http.baseUrl, window.location),
      token: auth.token,
      projectIds,
      onInvalidation: (projectId) => {
        clearTimeout(timers.get(projectId));
        timers.set(
          projectId,
          setTimeout(() => {
            timers.delete(projectId);
            void store.reloadProject(projectId);
          }, 250),
        );
      },
      onResync: () => void store.load(),
    });
    let known = projectIds().join(",");
    const unsubscribe = store.subscribe(() => {
      const now = projectIds().join(",");
      if (now !== known) {
        known = now;
        realtime.resubscribe();
      }
    });
    return () => {
      unsubscribe();
      realtime.stop();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, [phase, store]);

  const switchOrganization = useCallback(
    (id: string) => {
      auth.switchOrganization(id).catch(() => store.notify("Não foi possível trocar de empresa", "", "err"));
    },
    [store],
  );
  const logout = useCallback(() => {
    auth.logout().catch(() => {
      // the local session is already closed (login screen); the server cookie expires on its own
    });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: memberships arrive with the first load (phase)
  const controls = useMemo<SessionControls>(
    () => ({
      organizationId,
      memberships: store.memberships(),
      switchOrganization,
      logout,
      reload: () => void store.load(),
      callMcp: (name, args) => callMcpTool({ baseUrl: http.baseUrl, tokens: auth }, name, args),
      versionOf: store.versionOf,
      notificationChannels: () => store.commands.notificationPreferences(),
      admin: {
        setMemberActive: store.act.setMemberActive,
        createInvitation: (input) => store.commands.createInvitation(input),
        listInvitations: () => store.commands.listInvitations(),
        revokeInvitation: async (id) => {
          await store.commands.revokeInvitation(id);
        },
      },
    }),
    [organizationId, store, switchOrganization, logout, phase],
  );

  if (phase === "loading") return <AuthLoading label="Carregando o Workspace…" />;
  if (phase === "error") return <ServiceUnavailable onRetry={() => setAttempt((n) => n + 1)} />;
  return (
    <SessionContext.Provider value={controls}>
      <App />
    </SessionContext.Provider>
  );
}
