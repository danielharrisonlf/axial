import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectModal, TaskModal } from "./components/Forms";
import { Icon } from "./components/Icon";
import { TaskDrawer, TaskTable } from "./components/Tasks";
import {
  Avatar,
  Empty,
  MenuButton,
  Overlay,
  PageHead,
  roles,
  Select,
  type TaskDefaults,
  UIContext,
} from "./components/ui";
import type { Project } from "./data/types";
import { useWorkspace } from "./data/workspace";
import { navigate, rel } from "./lib/format";
import { Dashboard } from "./pages/Dashboard";
import { Notifications } from "./pages/Notifications";
import { ProjectDetail, Projects } from "./pages/Projects";
import { Backlog, Board, Sprints, Timeline } from "./pages/Work";
import "./app.css";

type ModalState =
  | { kind: "project"; existing?: Project }
  | { kind: "task"; defaults?: TaskDefaults }
  | { kind: "confirm"; title: string; message: string; label: string; action: () => void }
  | null;
const nav: { head: string; items: [string, string, string][] }[] = [
  {
    head: "Workspace",
    items: [
      ["dashboard", "Início", "home"],
      ["projects", "Meus projetos", "folders"],
      ["my-tasks", "Minhas tarefas", "tasks"],
      ["teams", "Equipes", "users"],
    ],
  },
  {
    head: "Projetos",
    items: [
      ["board", "Kanban", "board"],
      ["backlog", "Backlog", "backlog"],
      ["sprints", "Sprints", "sprint"],
      ["timeline", "Cronograma", "calendar"],
    ],
  },
  {
    head: "Inteligência e integrações",
    items: [
      ["assistant", "Assistente de IA", "sparkle"],
      ["mcp", "Agentes MCP", "plug"],
      ["webhooks", "Webhooks", "webhook"],
      ["notifications", "Notificações", "bell"],
    ],
  },
  {
    head: "Gestão",
    items: [
      ["access", "Usuários e permissões", "shield"],
      ["settings", "Configurações", "settings"],
    ],
  },
];
const enabled = new Set([
  "dashboard",
  "projects",
  "my-tasks",
  "teams",
  "board",
  "backlog",
  "sprints",
  "timeline",
  "notifications",

  "settings",
]);
const titles: Record<string, string> = {
  dashboard: "Início",
  projects: "Projetos",
  "my-tasks": "Minhas tarefas",
  teams: "Equipes",
  board: "Kanban",
  backlog: "Backlog",
  sprints: "Sprints",
  timeline: "Cronograma",
  notifications: "Notificações",
  access: "Usuários e permissões",
  settings: "Configurações",
};
function useHash() {
  const [path, setPath] = useState(() => window.location.hash.slice(1) || "/dashboard");
  useEffect(() => {
    const listener = () => setPath(window.location.hash.slice(1) || "/dashboard");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  return path.split("/").filter(Boolean);
}
export default function App() {
  const { db, me, can, act, toasts, notify, accessibleProjects } = useWorkspace();
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme =
      db.settings.theme === "system" ? (systemDark ? "dark" : "light") : db.settings.theme;
  }, [db.settings.theme, systemDark]);
  const [route = "dashboard", id, tab] = useHash();
  const [modal, setModal] = useState<ModalState>(null),
    [taskId, setTaskId] = useState<string | null>(null),
    [navOpen, setNavOpen] = useState(false),
    [search, setSearch] = useState(""),
    [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null),
    searchWrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setModal(null), []);
  const ui = {
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
    confirm: (title: string, message: string, action: () => void, label = "Confirmar") =>
      setModal({ kind: "confirm", title, message, action, label }),
  };
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "n" && !modal && !taskId && can("task.create")) {
        e.preventDefault();
        setModal({ kind: "task" });
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [can, modal, taskId]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!searchWrap.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    setNavOpen(false);
    setTaskId(null);
    setModal(null);
  }, []);
  const matches = search.trim().toLowerCase(),
    projects = useWorkspace().visibleProjects,
    tasks = useWorkspace().visibleTasks;
  const foundP =
      matches.length >= 2
        ? projects.filter((p) => `${p.name} ${p.key}`.toLowerCase().includes(matches)).slice(0, 3)
        : [],
    foundT =
      matches.length >= 2
        ? tasks.filter((t) => `${t.title} ${t.ref}`.toLowerCase().includes(matches)).slice(0, 6)
        : [];
  const p =
    route === "projects" && id
      ? accessibleProjects.find((p) => p.id === id && (!p.archived || can("project.archive")))
      : undefined;
  const dark = db.settings.theme === "dark" || (db.settings.theme === "system" && systemDark);
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
      <Notifications tab={id} />
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
      <Empty icon="folders" title="Página não encontrada" sub="Escolha uma seção na navegação lateral." />
    );
  return (
    <UIContext.Provider value={ui}>
      <div className={`shell${navOpen ? " nav-open" : ""}`} data-app="workspace">
        <aside className="sidebar">
          <div className="sb-brand">
            <span className="sb-logo" aria-hidden="true">
              A
            </span>
            <span>
              <b>Axial</b>
              <span className="env">Workspace</span>
            </span>
          </div>
          <div className="app-switch" role="tablist" aria-label="Alternar aplicação">
            <button
              type="button"
              role="tab"
              aria-selected="true"
              className="active"
              onClick={() => navigate("/dashboard")}
            >
              Workspace
            </button>
            <button
              type="button"
              role="tab"
              aria-selected="false"
              aria-disabled="true"
              title="Insights estará disponível em uma próxima etapa"
            >
              Insights
            </button>
          </div>
          <nav className="sb-nav" aria-label="Navegação principal">
            {nav.map((section) => (
              <div className="sb-section" key={section.head}>
                <div className="sb-section-title">{section.head}</div>
                {section.items.map(([key, label, icon]) => (
                  <button
                    type="button"
                    className={`sb-item${route === key ? " active" : ""}`}
                    key={key}
                    aria-current={route === key ? "page" : undefined}
                    aria-disabled={!enabled.has(key) || undefined}
                    title={!enabled.has(key) ? "Disponível em uma próxima etapa" : undefined}
                    onClick={() => {
                      if (enabled.has(key)) {
                        navigate(`/${key}`);
                        setNavOpen(false);
                      }
                    }}
                  >
                    <Icon name={icon} size={16} />
                    <span className="grow">{label}</span>
                    {key === "my-tasks" &&
                      tasks.filter((t) => t.assigneeId === me.id && t.status !== "done").length > 0 && (
                        <span className="cnt num">
                          {tasks.filter((t) => t.assigneeId === me.id && t.status !== "done").length}
                        </span>
                      )}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="sb-footer">
            <button
              type="button"
              className="sb-item"
              onClick={() =>
                ui.confirm(
                  "Restaurar demonstração",
                  "Os dados e alterações desta demonstração local serão substituídos pelos dados de exemplo originais.",
                  act.resetDemo,
                  "Restaurar demonstração",
                )
              }
            >
              <Icon name="refresh" size={16} />
              <span className="grow">Restaurar demonstração</span>
            </button>
          </div>
        </aside>
        <div className="main">
          <div className="topbar">
            <button
              type="button"
              className="btn btn-ghost btn-icon tb-burger"
              aria-label="Abrir menu"
              onClick={() => setNavOpen((v) => !v)}
            >
              <Icon name="menu" />
            </button>
            <div className="crumbs">
              <a href="#/dashboard">Workspace</a>
              <span className="sep">/</span>
              {p ? (
                <>
                  <a href="#/projects">Projetos</a>
                  <span className="sep">/</span>
                  <span className="cur">{p.name}</span>
                </>
              ) : (
                <span className="cur">{titles[route] || "Workspace"}</span>
              )}
            </div>
            <div className="tb-search" ref={searchWrap}>
              <span className="ic">
                <Icon name="search" size={14} />
              </span>
              <input
                ref={searchRef}
                className="input"
                type="search"
                placeholder="Buscar tarefas e projetos…"
                aria-label="Buscar"
                value={search}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchOpen(false);
                    searchRef.current?.blur();
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    searchWrap.current?.querySelector<HTMLButtonElement>(".menu-item")?.focus();
                  }
                  if (e.key === "Enter") {
                    if (foundP[0]) navigate(`/projects/${foundP[0].id}`);
                    else if (foundT[0]) ui.openTask(foundT[0].id);
                    setSearchOpen(false);
                    setSearch("");
                  }
                }}
              />
              {searchOpen && matches.length >= 2 && (
                <div
                  className="results"
                  role="menu"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSearchOpen(false);
                      searchRef.current?.focus();
                    }
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const buttons = Array.from(
                          searchWrap.current?.querySelectorAll<HTMLButtonElement>(".menu-item") || [],
                        ),
                        i = buttons.indexOf(document.activeElement as HTMLButtonElement);
                      buttons[
                        (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
                      ]?.focus();
                    }
                  }}
                >
                  {!foundP.length && !foundT.length && <div className="menu-head">Nenhum resultado</div>}
                  {foundP.map((p) => (
                    <button
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      key={p.id}
                      onClick={() => {
                        navigate(`/projects/${p.id}`);
                        setSearch("");
                        setSearchOpen(false);
                      }}
                    >
                      <Icon name="folders" size={14} />
                      <span className="grow">
                        {p.name}
                        <span className="mi-sub">Projeto · {p.key}</span>
                      </span>
                    </button>
                  ))}
                  {foundT.map((t) => (
                    <button
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      key={t.id}
                      onClick={() => {
                        ui.openTask(t.id);
                        setSearch("");
                        setSearchOpen(false);
                      }}
                    >
                      <Icon name="tasks" size={14} />
                      <span className="grow">
                        {t.title}
                        <span className="mi-sub">{t.ref}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={dark ? "Mudar para tema claro" : "Mudar para tema escuro"}
              data-tip={dark ? "Tema claro" : "Tema escuro"}
              onClick={() => act.setTheme(dark ? "light" : "dark")}
            >
              <Icon name={dark ? "sun" : "moon"} />
            </button>
            <MenuButton
              className="btn btn-ghost btn-icon bell-wrap"
              label="Notificações"
              items={[
                "Notificações recentes",
                ...db.notifications
                  .filter((n) => me.roleId === "admin" || n.toUserId === me.id)
                  .slice(0, 5)
                  .map((n) => ({
                    label: n.subject,
                    icon: n.channel === "email" ? "mail" : n.channel === "sms" ? "sms" : "wapp",
                    sub: `${rel(n.ts)}${n.status === "failed" ? " · FALHOU" : ""}`,
                    onClick: () => notify(n.subject, n.body, n.status === "failed" ? "warn" : "info"),
                  })),
                "sep",
                {
                  label: "Ver todas as notificações",
                  icon: "bell",
                  onClick: () => navigate("/notifications"),
                },
              ]}
            >
              <Icon name="bell" />
              {db.notifications.some((n) => n.status === "failed") && <span className="notif-dot" />}
            </MenuButton>
            <MenuButton
              label="Trocar perfil de demonstração"
              className="profile-btn"
              items={[
                "Perfis de demonstração",
                ...["u1", "u2", "u4", "u8", "u18"]
                  .map((uid) => db.users.find((u) => u.id === uid))
                  .filter((u): u is NonNullable<typeof u> => !!u)
                  .map((u) => ({
                    label: u.name,
                    sub: `${roles[u.roleId]} · ${u.title}`,
                    node: <Avatar user={u} size="sm" />,
                    checked: u.id === me.id,
                    onClick: () => act.setUser(u.id),
                  })),
                "sep",
                "Outros usuários",
                ...db.users
                  .filter((u) => !["u1", "u2", "u4", "u8", "u18"].includes(u.id) && !u.invited)
                  .slice(0, 5)
                  .map((u) => ({
                    label: u.name,
                    sub: roles[u.roleId],
                    node: <Avatar user={u} size="sm" />,
                    checked: u.id === me.id,
                    onClick: () => act.setUser(u.id),
                  })),
              ]}
            >
              <Avatar user={me} />
              <span className="who">
                <b>{me.name}</b>
                <span>{roles[me.roleId]}</span>
              </span>
              <Icon name="chevD" size={13} />
            </MenuButton>
          </div>
          <main className="content">
            <div
              className={`page${route === "board" || route === "timeline" ? " wide" : ""}`}
              key={`${route}/${id || ""}`}
            >
              {page}
            </div>
          </main>
        </div>
      </div>
      {modal?.kind === "project" && <ProjectModal existing={modal.existing} onClose={close} />}
      {modal?.kind === "task" && <TaskModal defaults={modal.defaults} onClose={close} />}
      {modal?.kind === "confirm" && (
        <Overlay
          title={modal.title}
          onClose={close}
          foot={
            <>
              <button type="button" className="btn" onClick={close}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  modal.action();
                  close();
                }}
              >
                {modal.label}
              </button>
            </>
          }
        >
          <p>{modal.message}</p>
        </Overlay>
      )}
      {taskId && <TaskDrawer key={taskId} id={taskId} onClose={() => setTaskId(null)} />}
      <div id="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span className="t-ic">
              <Icon name={t.tone === "ok" ? "check" : "info"} />
            </span>
            <div className="grow">
              <b>{t.title}</b>
              <span>{t.message}</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              aria-label="Fechar notificação"
              onClick={() => act.dismissToast(t.id)}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
    </UIContext.Provider>
  );
}
function Teams() {
  const { db, visibleTasks } = useWorkspace();
  return (
    <>
      <PageHead
        title="Equipes"
        sub="Organização, liderança e integrantes. Uma pessoa pode estar em várias equipes."
      />
      <div className="grid c3">
        {db.teams.map((tm) => {
          const open = visibleTasks.filter((t) => t.teamId === tm.id && t.status !== "done" && !t.parentId);
          return (
            <div className="panel" key={tm.id}>
              <div className="panel-head">
                <h3>{tm.name}</h3>
                <span className="spacer" />
                <span className="chip">{db.orgs.find((o) => o.id === tm.orgId)?.name}</span>
              </div>
              <div className="panel-body">
                <p className="muted" style={{ fontSize: 12 }}>
                  {tm.desc}
                </p>
                <div className="inline-row" style={{ marginBottom: 10 }}>
                  <span className="avatar-stack">
                    {tm.memberIds.slice(0, 6).map((id) => (
                      <Avatar key={id} user={db.users.find((u) => u.id === id)} size="sm" />
                    ))}
                  </span>
                  <span className="subtle" style={{ fontSize: 11.5 }}>
                    {tm.memberIds.length} integrantes
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  <b className="num">{open.length}</b> abertas
                </div>
                <details style={{ marginTop: 12 }}>
                  <summary className="btn btn-sm">Ver integrantes</summary>
                  {tm.memberIds.map((id) => {
                    const u = db.users.find((u) => u.id === id);
                    return (
                      u && (
                        <div className="hist-item" key={id}>
                          <Avatar user={u} size="sm" />
                          <span className="grow">{u.name}</span>
                          {tm.leadId === id && <span className="chip accent">líder</span>}
                        </div>
                      )
                    );
                  })}
                </details>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
function Settings() {
  const { db, act } = useWorkspace();
  return (
    <>
      <PageHead title="Configurações" sub="Preferências da aplicação e dados da demonstração." />
      <div className="panel" style={{ maxWidth: 720 }}>
        <div className="panel-head">
          <h3>Aparência</h3>
        </div>
        <div className="panel-body">
          <Select
            label="Tema"
            value={db.settings.theme}
            onChange={(v) => act.setTheme(v as "light" | "dark" | "system")}
            options={[
              { value: "light", label: "Claro" },
              { value: "dark", label: "Escuro" },
              { value: "system", label: "Sistema" },
            ]}
          />
        </div>
      </div>
      <div className="panel" style={{ maxWidth: 720, marginTop: 14 }}>
        <div className="panel-head">
          <h3>Ambiente de demonstração</h3>
        </div>
        <div className="panel-body">
          <p className="muted">
            Os projetos e pessoas são exemplos fictícios. Alterações ficam salvas neste navegador.
          </p>
        </div>
      </div>
    </>
  );
}
