import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectModal, TaskModal } from "./components/Forms";
import { Icon } from "./components/Icon";
import { TaskDrawer, TaskTable } from "./components/Tasks";
import {
  Avatar,
  announce,
  ConfirmDialog,
  type ConfirmOptions,
  Empty,
  LiveRegions,
  MenuButton,
  NoAccess,
  PageHead,
  roles,
  type TaskDefaults,
  Toasts,
  TypeIcon,
  topLayerKind,
  UIContext,
  useLayer,
} from "./components/ui";
import { toRoleId } from "./data/api/mappers";
import type { Project } from "./data/types";
import { useWorkspace } from "./data/workspace";
import { navigate, rel, STATUS_META } from "./lib/format";
import { Dashboard } from "./pages/Dashboard";
import { useSession } from "./session";

// Route-level code splitting: the initial bundle ships the shell, while each
// page is fetched on demand.
const Insights = lazy(() => import("./pages/Insights").then((module) => ({ default: module.Insights })));
const Access = lazy(() => import("./pages/Access").then((module) => ({ default: module.Access })));
const Notifications = lazy(() =>
  import("./pages/Notifications").then((module) => ({ default: module.Notifications })),
);
const Projects = lazy(() => import("./pages/Projects").then((module) => ({ default: module.Projects })));
const ProjectDetail = lazy(() =>
  import("./pages/Projects").then((module) => ({ default: module.ProjectDetail })),
);
const Board = lazy(() => import("./pages/Work").then((module) => ({ default: module.Board })));
const Backlog = lazy(() => import("./pages/Work").then((module) => ({ default: module.Backlog })));
const Sprints = lazy(() => import("./pages/Work").then((module) => ({ default: module.Sprints })));
const Timeline = lazy(() => import("./pages/Work").then((module) => ({ default: module.Timeline })));
const Teams = lazy(() => import("./pages/Teams").then((module) => ({ default: module.Teams })));
const Settings = lazy(() => import("./pages/Settings").then((module) => ({ default: module.Settings })));
const Mcp = lazy(() => import("./pages/Mcp").then((module) => ({ default: module.Mcp })));

type ModalState = { kind: "project"; existing?: Project } | { kind: "task"; defaults?: TaskDefaults } | null;
type NavEntry = { route: string; label: string; icon: string };
const NAV_WORKSPACE: { head: string; items: NavEntry[] }[] = [
  {
    head: "Workspace",
    items: [
      { route: "dashboard", label: "Início", icon: "home" },
      { route: "projects", label: "Projetos", icon: "folders" },
      { route: "my-tasks", label: "Minhas tarefas", icon: "tasks" },
      { route: "teams", label: "Equipes", icon: "users" },
    ],
  },
  {
    head: "Projetos",
    items: [
      { route: "board", label: "Kanban", icon: "board" },
      { route: "backlog", label: "Backlog", icon: "backlog" },
      { route: "sprints", label: "Sprints", icon: "sprint" },
      { route: "timeline", label: "Cronograma", icon: "calendar" },
    ],
  },
  {
    head: "Inteligência e integrações",
    items: [
      { route: "mcp", label: "Agentes MCP", icon: "plug" },
      { route: "notifications", label: "Notificações", icon: "bell" },
    ],
  },
  {
    head: "Gestão",
    items: [
      { route: "access", label: "Usuários e permissões", icon: "shield" },
      { route: "settings", label: "Configurações", icon: "settings" },
    ],
  },
];
const AUDIT_ROLES = new Set(["admin", "pm", "lead"]);
const NAV_INSIGHTS: NavEntry[] = [
  { route: "insights", label: "Visão executiva", icon: "pulse" },
  { route: "insights/analytics", label: "Análise de projetos", icon: "chart" },
  { route: "insights/audit", label: "Central de auditoria", icon: "scroll" },
];
const titles: Record<string, string> = {
  dashboard: "Início",
  projects: "Projetos",
  "my-tasks": "Minhas tarefas",
  teams: "Equipes",
  board: "Kanban",
  backlog: "Backlog",
  sprints: "Sprints",
  timeline: "Cronograma",
  mcp: "Agentes MCP",
  notifications: "Notificações",
  insights: "Visão executiva",
  "insights/analytics": "Análise de projetos",
  "insights/audit": "Central de auditoria",
  access: "Usuários e permissões",
  settings: "Configurações",
};
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

function useHash() {
  const [path, setPath] = useState(() => window.location.hash.slice(1) || "/dashboard");
  useEffect(() => {
    const listener = () => setPath(window.location.hash.slice(1) || "/dashboard");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  return path.split("/").filter(Boolean);
}
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 860px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}
/** Registers the off-canvas navigation as a layer: Esc closes it and the backdrop dims the page. */
function NavLayer({
  sidebar,
  trigger,
  onClose,
}: {
  sidebar: React.RefObject<HTMLElement | null>;
  trigger: HTMLElement | null;
  onClose: () => void;
}) {
  // the burger is passed explicitly: .main turns inert in the same commit and drops its focus
  useLayer("nav", sidebar, onClose, { trigger });
  useEffect(() => {
    // after the sidebar becomes visible: focus the current page in the navigation
    const frame = requestAnimationFrame(() => {
      const el = sidebar.current;
      (
        el?.querySelector<HTMLElement>(".sb-item[aria-current=page]") ??
        el?.querySelector<HTMLElement>(".sb-item")
      )?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [sidebar]);
  return <div className="backdrop nav-backdrop" aria-hidden="true" onClick={onClose} />;
}

export default function App() {
  const {
    db,
    me,
    can,
    act,
    visibleProjects: projects,
    visibleTasks: tasks,
    visibleNotifications,
    accessibleProjects,
    sync,
  } = useWorkspace();
  const session = useSession();
  useEffect(() => {
    // "Sistema" leaves the decision to color-scheme (prefers-color-scheme); light/dark force it
    const root = document.documentElement;
    root.classList.add("theme-switching");
    if (db.settings.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = db.settings.theme;
    const t = requestAnimationFrame(() => root.classList.remove("theme-switching"));
    return () => cancelAnimationFrame(t);
  }, [db.settings.theme]);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const parts = useHash();
  const [route = "dashboard", id, tab] = parts;
  const key = route === "insights" && id ? `insights/${id}` : route;
  const app = route === "insights" ? "insights" : "workspace";
  const [modal, setModal] = useState<ModalState>(null);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const narrow = useNarrow();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchWrap = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setModal(null), []);
  const ui = useMemo(
    () => ({
      project: (p?: Project) => {
        if (can(p ? "project.edit" : "project.create")) {
          setTaskId(null);
          setModal({ kind: "project", existing: p });
        }
      },
      task: (defaults?: TaskDefaults) => {
        if (can("task.create")) {
          setTaskId(null);
          setModal({ kind: "task", defaults });
        }
      },
      openTask: (tid: string) => {
        setModal(null);
        setTaskId(tid);
      },
      openTaskId: taskId,
      confirm: (options: ConfirmOptions) => setConfirm(options),
    }),
    [can, taskId],
  );
  // global shortcuts: Ctrl/⌘+K focuses search (not over a dialog); "n" opens a new task
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      const layer = topLayerKind();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        if (layer === "modal" || layer === "drawer") return;
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))
      )
        return;
      if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !layer && can("task.create")) {
        e.preventDefault();
        setTaskId(null);
        setModal({ kind: "task" });
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [can]);
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!searchWrap.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, []);
  // route change: close overlays, focus the page title and announce it (not on the first load;
  // comparing with the previous route also survives StrictMode's double effect run)
  const routeKey = parts.join("/");
  const lastRoute = useRef(routeKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per route
  useEffect(() => {
    if (lastRoute.current === routeKey) return;
    lastRoute.current = routeKey;
    setNavOpen(false);
    setModal(null);
    setTaskId(null);
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    // pages load lazily: wait (briefly) for the new h1 before moving focus
    const focusTitle = () => {
      const h1 = document.querySelector<HTMLElement>("#conteudo h1");
      if (!h1 && tries++ < 20) {
        timer = setTimeout(focusTitle, 50);
        return;
      }
      (h1 ?? document.getElementById("conteudo"))?.focus({ preventScroll: true });
      announce(`Página: ${h1?.textContent ?? titles[key] ?? "Kairos"}`);
    };
    timer = setTimeout(focusTitle, 30);
    return () => clearTimeout(timer);
  }, [routeKey]);
  const p =
    route === "projects" && id
      ? accessibleProjects.find((x) => x.id === id && (!x.archived || can("project.archive")))
      : undefined;
  const pageTitle = p?.name ?? titles[key] ?? "Workspace";
  useEffect(() => {
    document.title = `${pageTitle} · Kairos`;
  }, [pageTitle]);
  useEffect(() => {
    if (!narrow) setNavOpen(false);
  }, [narrow]);

  const q = search.trim().toLowerCase();
  const foundP =
    q.length >= 2 ? projects.filter((x) => `${x.name} ${x.key}`.toLowerCase().includes(q)).slice(0, 3) : [];
  const foundT =
    q.length >= 2 ? tasks.filter((t) => `${t.title} ${t.ref}`.toLowerCase().includes(q)).slice(0, 6) : [];
  const resultCount = foundP.length + foundT.length;
  useEffect(() => {
    if (q.length < 2) return;
    const t = setTimeout(
      () =>
        announce(resultCount ? `${resultCount} resultados. Use as setas para navegar.` : "Nenhum resultado"),
      300,
    );
    return () => clearTimeout(t);
  }, [q, resultCount]);
  // arrows move between results; Esc returns to the field
  const resultKeys = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const list = Array.from(
      searchWrap.current?.querySelectorAll<HTMLButtonElement>(".results .menu-item") ?? [],
    );
    const i = list.indexOf(e.currentTarget);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[i + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i > 0) list[i - 1]?.focus();
      else searchRef.current?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setSearchOpen(false);
      searchRef.current?.focus();
    }
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setSearch("");
  };
  const dark = db.settings.theme === "dark" || (db.settings.theme === "system" && systemDark);
  const myOpen = tasks.filter((t) => !t.parentId && t.assigneeId === me.id && t.status !== "done").length;
  const org = db.orgs.find((o) => o.id === me.orgId);
  const notifications = visibleNotifications;
  const canAudit = AUDIT_ROLES.has(me.roleId) && can("audit.view");
  const navItem = (it: NavEntry, count?: number) => {
    const on = key === it.route;
    return (
      <a
        key={it.route}
        className={`sb-item${on ? " active" : ""}`}
        href={`#/${it.route}`}
        aria-current={on ? "page" : undefined}
        onClick={() => setNavOpen(false)}
      >
        <Icon name={it.icon} size={16} />
        <span className="grow">{it.label}</span>
        {!!count && <span className="cnt">{count}</span>}
      </a>
    );
  };

  const page =
    route === "projects" ? (
      id ? (
        <ProjectDetail id={id} tab={tab} />
      ) : (
        <Projects />
      )
    ) : route === "dashboard" ? (
      <Dashboard />
    ) : route === "board" ? (
      <Board />
    ) : route === "backlog" ? (
      <Backlog />
    ) : route === "sprints" ? (
      <Sprints />
    ) : route === "timeline" ? (
      <Timeline />
    ) : route === "notifications" ? (
      <Notifications tab={id} open={tab} />
    ) : route === "insights" ? (
      can("insights.view") ? (
        <Insights view={id === "analytics" || id === "audit" ? id : "executive"} />
      ) : (
        <NoAccess what="ao Insights" />
      )
    ) : route === "access" ? (
      <Access tab={id} />
    ) : route === "mcp" ? (
      <Mcp tab={id} />
    ) : route === "my-tasks" ? (
      <>
        <PageHead title="Minhas tarefas" sub={`Tudo o que está atribuído a ${me.name}.`}>
          {can("task.create") && (
            <button type="button" className="btn btn-primary" onClick={() => ui.task({ assigneeId: me.id })}>
              <Icon name="plus" size={14} />
              Nova tarefa
            </button>
          )}
        </PageHead>
        <TaskTable assigneeId={me.id} />
      </>
    ) : route === "teams" ? (
      <Teams />
    ) : route === "settings" ? (
      <Settings />
    ) : (
      <Empty icon="folders" title="Página não encontrada" sub="Escolha uma seção na navegação lateral.">
        <a className="btn" href="#/dashboard">
          Voltar ao início
        </a>
      </Empty>
    );
  return (
    <UIContext.Provider value={ui}>
      {/* biome-ignore lint/a11y/useValidAnchor: hash routing; the skip link moves focus without changing the route */}
      <a
        className="skip-link"
        href="#conteudo"
        onClick={(e) => {
          // hash routing: move focus without touching the route
          e.preventDefault();
          document.getElementById("conteudo")?.focus();
        }}
      >
        Pular para o conteúdo
      </a>
      <div id="app-shell" className={`shell${navOpen ? " nav-open" : ""}`} data-app={app}>
        <aside className="sidebar" id="sidebar" aria-label="Menu lateral" ref={sidebarRef}>
          <div className="sb-brand">
            <span className="sb-logo" aria-hidden="true">
              <Icon name="logo" size={18} />
            </span>
            <span className="sb-brand-txt">
              <b>Kairos</b>
              <span className="env">
                {org ? `${org.name} · ` : ""}
                {app === "insights" ? "Insights" : "Workspace"}
              </span>
            </span>
            {navOpen && (
              <button
                type="button"
                className="btn btn-ghost btn-icon sb-close"
                aria-label="Fechar menu"
                onClick={() => setNavOpen(false)}
              >
                <Icon name="x" />
              </button>
            )}
          </div>
          <nav className="app-switch" aria-label="Alternar aplicação">
            <a
              href="#/dashboard"
              aria-current={app === "workspace" ? "page" : undefined}
              className={app === "workspace" ? "active" : ""}
            >
              Workspace
            </a>
            <a
              href="#/insights"
              aria-current={app === "insights" ? "page" : undefined}
              className={app === "insights" ? "active" : ""}
            >
              Insights
            </a>
          </nav>
          <nav className="sb-nav" aria-label="Navegação principal">
            {app === "insights" ? (
              <div className="sb-section">
                <div className="sb-section-title">Insights</div>
                {NAV_INSIGHTS.filter((it) => it.route !== "insights/audit" || canAudit).map((it) =>
                  navItem(it),
                )}
              </div>
            ) : (
              NAV_WORKSPACE.map((section) => (
                <div className="sb-section" key={section.head}>
                  <div className="sb-section-title">{section.head}</div>
                  {section.items.map((it) => navItem(it, it.route === "my-tasks" ? myOpen : undefined))}
                </div>
              ))
            )}
          </nav>
        </aside>
        {navOpen && narrow && (
          <NavLayer sidebar={sidebarRef} trigger={burgerRef.current} onClose={() => setNavOpen(false)} />
        )}
        <div className="main" inert={navOpen && narrow ? true : undefined}>
          <header className="topbar">
            <button
              ref={burgerRef}
              type="button"
              className="btn btn-ghost btn-icon tb-burger"
              aria-label="Abrir menu de navegação"
              aria-expanded={navOpen}
              aria-controls="sidebar"
              onClick={() => setNavOpen((v) => !v)}
            >
              <Icon name="menu" />
            </button>
            <nav className="crumbs" aria-label="Você está em">
              <a href={app === "insights" ? "#/insights" : "#/dashboard"}>
                <Icon name={app === "insights" ? "pulse" : "layers"} size={14} />
                {app === "insights" ? "Insights" : "Workspace"}
              </a>
              <span className="sep" aria-hidden="true">
                <Icon name="chevR" size={12} />
              </span>
              {p && (
                <>
                  <a href="#/projects">Projetos</a>
                  <span className="sep" aria-hidden="true">
                    <Icon name="chevR" size={12} />
                  </span>
                </>
              )}
              <span className="cur" aria-current="page">
                {pageTitle}
              </span>
            </nav>
            <search className="tb-search" ref={searchWrap}>
              <span className="ic">
                <Icon name="search" size={14} />
              </span>
              <input
                ref={searchRef}
                className="input"
                type="search"
                placeholder="Buscar tarefas e projetos…"
                aria-label="Buscar tarefas e projetos"
                aria-controls="busca-resultados"
                aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
                value={search}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setSearchOpen(false);
                    searchRef.current?.blur();
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    searchWrap.current?.querySelector<HTMLButtonElement>(".results .menu-item")?.focus();
                  }
                  if (e.key === "Enter")
                    searchWrap.current?.querySelector<HTMLButtonElement>(".results .menu-item")?.click();
                }}
              />
              <span className="tb-kbd" aria-hidden="true">
                <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
                <kbd>K</kbd>
              </span>
              {searchOpen && q.length >= 2 && (
                <div className="results" id="busca-resultados">
                  {!resultCount && (
                    <div className="menu-head" role="status">
                      Nenhum resultado
                    </div>
                  )}
                  {foundP.map((x) => (
                    <button
                      type="button"
                      className="menu-item"
                      key={x.id}
                      onKeyDown={resultKeys}
                      onClick={() => {
                        closeSearch();
                        navigate(`/projects/${x.id}`);
                      }}
                    >
                      <Icon name="folders" size={14} />
                      <span className="grow">
                        {x.name}
                        <span className="mi-sub">Projeto · {x.key}</span>
                      </span>
                    </button>
                  ))}
                  {foundT.map((t) => (
                    <button
                      type="button"
                      className="menu-item"
                      key={t.id}
                      onKeyDown={resultKeys}
                      onClick={() => {
                        closeSearch();
                        ui.openTask(t.id);
                      }}
                    >
                      <TypeIcon type={t.type} decorative />
                      <span className="grow">
                        {t.title}
                        <span className="mi-sub">
                          {t.ref} · {STATUS_META[t.status].label}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </search>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={dark ? "Mudar para tema claro" : "Mudar para tema escuro"}
              data-tip={dark ? "Tema claro" : "Tema escuro"}
              onClick={() => act.setTheme(dark ? "light" : "dark")}
            >
              <Icon name={dark ? "sun" : "moon"} />
            </button>
            {/* API mode: no endpoint lists deliveries yet, so there is no bell (no fake history) */}
            {!session && (
              <MenuButton
                className="btn btn-ghost btn-icon bell-wrap"
                label="Notificações"
                tip="Notificações"
                items={() => {
                  const recent = notifications.slice(0, 5);
                  return [
                    "Notificações recentes",
                    ...(recent.length ? [] : ["Nenhuma notificação"]),
                    ...recent.map((n) => {
                      const to = db.users.find((u) => u.id === n.toUserId);
                      return {
                        label: n.subject,
                        icon: n.channel === "email" ? "mail" : n.channel === "sms" ? "sms" : "wapp",
                        sub: `${to ? `para ${to.name} · ` : ""}${rel(n.ts)}${n.status === "failed" ? " · falhou" : ""}`,
                        onClick: () => navigate(`/notifications/history/${n.id}`),
                      };
                    }),
                    "sep",
                    {
                      label: "Ver todas as notificações",
                      icon: "bell",
                      onClick: () => navigate("/notifications"),
                    },
                  ];
                }}
              >
                <Icon name="bell" />
                {notifications.some((n) => n.status === "failed") && <span className="notif-dot" />}
              </MenuButton>
            )}
            {session ? (
              <MenuButton
                className="profile-btn"
                label={`${me.name}, ${roles[me.roleId]}. Menu da conta`}
                menuLabel="Conta"
                items={() => [
                  "Empresa",
                  ...session.memberships.map((m) => ({
                    label: m.organizationName,
                    icon: "building",
                    sub: roles[toRoleId(m.role)],
                    checked: m.organizationId === session.organizationId,
                    radio: true,
                    onClick: () => {
                      if (m.organizationId !== session.organizationId)
                        session.switchOrganization(m.organizationId);
                    },
                  })),
                  "sep",
                  { label: "Sair", icon: "external", onClick: session.logout },
                ]}
              >
                <Avatar user={me} decorative />
                <span className="who">
                  <b>{me.name}</b>
                  <span>{org ? `${roles[me.roleId]} · ${org.name}` : roles[me.roleId]}</span>
                </span>
              </MenuButton>
            ) : (
              <div className="profile-btn profile-static">
                <Avatar user={me} decorative />
                <span className="who">
                  <b>{me.name}</b>
                  <span>{roles[me.roleId]}</span>
                </span>
              </div>
            )}
          </header>
          <main className="content" id="conteudo" tabIndex={-1}>
            {sync?.stale && session && (
              <div className="banner danger stale-banner" role="alert">
                <Icon name="alert" size={16} />
                <span className="grow">
                  <b>Serviço indisponível.</b> {sync.message} Os dados mostrados são os últimos carregados e
                  as alterações estão desativadas.
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={sync.refreshing}
                  onClick={session.reload}
                >
                  <Icon name="refresh" size={12} />
                  {sync.refreshing ? "Recarregando…" : "Tentar novamente"}
                </button>
              </div>
            )}
            <div className={`page${route === "board" || route === "timeline" ? " wide" : ""}`} key={routeKey}>
              <Suspense
                fallback={
                  <div className="empty" role="status" aria-busy="true">
                    <b>Carregando…</b>
                  </div>
                }
              >
                {page}
              </Suspense>
            </div>
          </main>
        </div>
      </div>
      {modal?.kind === "project" && <ProjectModal existing={modal.existing} onClose={close} />}
      {modal?.kind === "task" && <TaskModal defaults={modal.defaults} onClose={close} />}
      {taskId && <TaskDrawer key={taskId} id={taskId} onClose={() => setTaskId(null)} />}
      {confirm && <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />}
      <Toasts />
      <LiveRegions />
    </UIContext.Provider>
  );
}
