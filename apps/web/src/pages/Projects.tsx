import { type ReactNode, useState } from "react";
import { Icon } from "../components/Icon";
import { TaskTable } from "../components/Tasks";
import {
  ActivityFeed,
  Avatar,
  announce,
  Empty,
  Field,
  FilterSelect,
  MenuButton,
  type MenuEntry,
  NoAccess,
  Overlay,
  PageHead,
  PriorityChip,
  Progress,
  ProjectDot,
  roles,
  TabNav,
  TypeIcon,
  useUI,
  Who,
} from "../components/ui";
import type { Project } from "../data/types";
import { useWorkspace } from "../data/workspace";
import { daysLeft, fmtDate, navigate, PRIORITIES, plural, projectProgress, projectRisk } from "../lib/format";

/* ==========================================================================
   Chips de status e risco do projeto (ícone + texto: a cor nunca fala sozinha)
   ========================================================================== */
const PROJECT_STATUS: Record<string, [tone: string, label: string, icon: string]> = {
  active: ["accent", "Ativo", "play"],
  paused: ["warn", "Pausado", "timer"],
  done: ["ok", "Concluído", "check"],
  archived: ["", "Arquivado", "archive"],
};
function ProjectStatusChip({ p }: { p: Project }) {
  const [tone, label, icon] = PROJECT_STATUS[p.archived ? "archived" : p.status] ?? [
    "accent",
    "Ativo",
    "play",
  ];
  return (
    <span className={`chip${tone ? ` ${tone}` : ""}`}>
      <Icon name={icon} size={12} />
      {label}
    </span>
  );
}
function RiskChip({ p }: { p: Project }) {
  const { db } = useWorkspace();
  const risk = projectRisk(db, p);
  const tone = risk.level === "high" ? "danger" : risk.level === "mid" ? "warn" : "ok";
  const icon = risk.level === "high" ? "alert" : risk.level === "mid" ? "info" : "check";
  return (
    <span className={`chip ${tone}`}>
      <Icon name={icon} size={12} />
      {risk.label}
    </span>
  );
}

/** Row and page-header menu; edit and archive/restore follow the profile's permissions. */
export function ProjectMenu({ p, label = "Ações do projeto" }: { p: Project; label?: string }) {
  const { can, act } = useWorkspace();
  const ui = useUI();
  const items = (): MenuEntry[] => [
    { label: "Abrir projeto", icon: "external", onClick: () => navigate(`/projects/${p.id}`) },
    {
      label: "Abrir Kanban",
      icon: "board",
      onClick: () => {
        act.setCurrentProject(p.id);
        navigate("/board");
      },
    },
    ...(can("project.edit", p.id) && !p.archived
      ? [{ label: "Editar", icon: "edit", onClick: () => ui.project(p) }]
      : []),
    ...(can("project.archive")
      ? [
          p.archived
            ? { label: "Restaurar", icon: "refresh", onClick: () => act.restoreProject(p.id) }
            : {
                label: "Arquivar",
                icon: "archive",
                onClick: () =>
                  ui.confirm({
                    title: "Arquivar projeto",
                    message: `O projeto “${p.name}” sai das listagens ativas. É possível restaurá-lo depois.`,
                    label: "Arquivar",
                    danger: true,
                    action: () => act.archiveProject(p.id),
                  }),
              },
        ]
      : []),
  ];
  return (
    <MenuButton label={label} items={items}>
      <Icon name="dots" size={15} />
    </MenuButton>
  );
}

/* ==========================================================================
   Lista de projetos
   ========================================================================== */
type SortKey = "name" | "status" | "priority" | "progress" | "lead" | "target" | "risk";
const STATUS_ORDER = ["active", "paused", "done"];
const RISK_ORDER = ["high", "mid", "ok"];

export function Projects() {
  const { db, visibleProjects, accessibleProjects, can, act, isFavorite } = useWorkspace();
  const ui = useUI();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const query = q.trim().toLowerCase();
  const matches = (p: Project) =>
    !query || p.name.toLowerCase().includes(query) || p.key.toLowerCase().includes(query);
  const showArchived = status === "archived" && can("project.archive");
  const filtered = showArchived
    ? accessibleProjects.filter((p) => p.archived && matches(p))
    : visibleProjects.filter((p) => (!status || p.status === status) && matches(p));
  const leadName = (p: Project) => db.users.find((u) => u.id === p.leadId)?.name ?? "";
  const sortValue = (p: Project, key: SortKey): string | number => {
    switch (key) {
      case "name":
        return p.name;
      case "status":
        return STATUS_ORDER.indexOf(p.status);
      case "priority":
        return PRIORITIES.indexOf(p.priority);
      case "progress":
        return projectProgress(db, p.id);
      case "lead":
        return leadName(p);
      case "target":
        return p.targetDate ?? "9999-99-99";
      case "risk":
        return RISK_ORDER.indexOf(projectRisk(db, p).level);
    }
  };
  const list = sort
    ? [...filtered].sort((a, b) => {
        const x = sortValue(a, sort.key);
        const y = sortValue(b, sort.key);
        const c =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x).localeCompare(String(y), "pt-BR", { sensitivity: "base" });
        return c * sort.dir;
      })
    : filtered;
  const clear = () => {
    setQ("");
    setStatus("");
  };
  const th = (key: SortKey, label: string) => {
    const on = sort?.key === key;
    return (
      <th aria-sort={on ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className="th-sort"
          onClick={() => {
            const dir: 1 | -1 = on && sort.dir > 0 ? -1 : 1;
            setSort({ key, dir });
            announce(`Ordenado por ${label}, ${dir > 0 ? "crescente" : "decrescente"}`);
          }}
        >
          {label}
        </button>
      </th>
    );
  };
  const rowName = (p: Project) => (
    <div className="cell-main">
      <ProjectDot project={p} lg />
      <div>
        <button type="button" className="row-link" onClick={() => navigate(`/projects/${p.id}`)}>
          {p.name}
        </button>
        <span className="cell-sub mono">{p.key}</span>
      </div>
    </div>
  );

  let body: ReactNode;
  if (!list.length) {
    body = showArchived ? (
      <Empty
        icon="archive"
        title="Nenhum projeto encontrado"
        sub="Projetos arquivados aparecem aqui e podem ser restaurados."
      />
    ) : q || status ? (
      <Empty
        icon="filter"
        title="Nenhum projeto encontrado"
        sub="Nenhum projeto corresponde à busca e ao status escolhidos."
      >
        <button type="button" className="btn" onClick={clear}>
          <Icon name="x" size={12} />
          Limpar filtros
        </button>
      </Empty>
    ) : (
      <Empty icon="folders" title="Nenhum projeto encontrado" sub="Crie o primeiro projeto para começar.">
        {can("project.create") && (
          <button type="button" className="btn btn-primary" onClick={() => ui.project()}>
            <Icon name="plus" size={14} />
            Novo projeto
          </button>
        )}
      </Empty>
    );
  } else if (showArchived) {
    body = (
      <div className="panel">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {th("name", "Projeto")}
                <th>Status</th>
                {th("lead", "Responsável")}
                {th("target", "Data de entrega")}
                <th className="actions-col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>{rowName(p)}</td>
                  <td>
                    <ProjectStatusChip p={p} />
                  </td>
                  <td>
                    <Who id={p.leadId} />
                  </td>
                  <td className="date">{fmtDate(p.targetDate)}</td>
                  <td className="actions-col">
                    <button type="button" className="btn btn-sm" onClick={() => act.restoreProject(p.id)}>
                      <Icon name="refresh" size={12} />
                      Restaurar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="panel">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="col-icon">
                  <span className="sr-only">Favorito</span>
                </th>
                {th("name", "Projeto")}
                {th("status", "Status")}
                {th("priority", "Prioridade")}
                {th("progress", "Progresso")}
                <th>Equipes</th>
                {th("lead", "Responsável")}
                {th("target", "Data de entrega")}
                {th("risk", "Risco")}
                <th className="actions-col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const prog = projectProgress(db, p.id);
                const fav = isFavorite(p.id);
                const teamNames = p.teamIds
                  .map((tid) => db.teams.find((t) => t.id === tid)?.name)
                  .filter((n): n is string => !!n);
                const rest = teamNames.slice(2);
                return (
                  <tr key={p.id}>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm star-btn"
                        aria-label={`Favoritar ${p.name}`}
                        aria-pressed={fav}
                        onClick={() => act.toggleFavorite(p.id)}
                      >
                        <Icon name="star" size={14} />
                      </button>
                    </td>
                    <td>{rowName(p)}</td>
                    <td>
                      <ProjectStatusChip p={p} />
                    </td>
                    <td>
                      <PriorityChip priority={p.priority} />
                    </td>
                    <td>
                      <div className="cell-prog">
                        <Progress value={prog} label={`Progresso de ${p.name}`} />
                        <span className="pct" aria-hidden="true">
                          {prog}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="cell-chips">
                        {teamNames.slice(0, 2).map((n) => (
                          <span className="chip" key={n}>
                            {n}
                          </span>
                        ))}
                        {rest.length > 0 && (
                          <span className="chip" data-tip={rest.join(", ")}>
                            <span aria-hidden="true">+{rest.length}</span>
                            <span className="sr-only">
                              mais {rest.length}: {rest.join(", ")}
                            </span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <Who id={p.leadId} />
                    </td>
                    <td className="date">{fmtDate(p.targetDate)}</td>
                    <td>
                      <RiskChip p={p} />
                    </td>
                    <td className="actions-col">
                      <ProjectMenu p={p} label={`Ações do projeto ${p.name}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHead title="Projetos" sub="Projetos visíveis para o perfil atual, com progresso e risco.">
        {can("project.create") && (
          <button type="button" className="btn btn-primary" onClick={() => ui.project()}>
            <Icon name="plus" size={14} />
            Novo projeto
          </button>
        )}
      </PageHead>
      <div className="fbar">
        <input
          className="input search"
          type="search"
          placeholder="Buscar por nome ou chave…"
          aria-label="Buscar projetos"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "Todos" },
            { value: "active", label: "Ativo" },
            { value: "paused", label: "Pausado" },
            { value: "done", label: "Concluído" },
            ...(can("project.archive") ? [{ value: "archived", label: "Arquivados" }] : []),
          ]}
        />
        {(q || status) && (
          <button type="button" className="btn btn-ghost btn-sm clear-f" onClick={clear}>
            <Icon name="x" size={12} />
            Limpar
          </button>
        )}
        <span className="grow" />
        <span className="subtle num fbar-count">
          {showArchived
            ? plural(list.length, "projeto arquivado", "projetos arquivados")
            : plural(list.length, "projeto", "projetos")}
        </span>
      </div>
      {body}
    </>
  );
}

/* ==========================================================================
   Detalhe do projeto
   ========================================================================== */
function MetaItem({ k, children, grow = false }: { k: string; children: ReactNode; grow?: boolean }) {
  return (
    <div className={`meta-item${grow ? " grow" : ""}`}>
      <span className="mk">{k}</span>
      <span className="mv">{children}</span>
    </div>
  );
}

export function ProjectDetail({ id, tab = "overview" }: { id: string; tab?: string }) {
  const { db, visibleProjects, accessibleProjects, can, act } = useWorkspace();
  const ui = useUI();
  const [epic, setEpic] = useState(false);
  const archived = accessibleProjects.find((x) => x.id === id && x.archived && can("project.archive"));
  const p = visibleProjects.find((x) => x.id === id);
  if (archived)
    return (
      <Empty
        icon="archive"
        title="Projeto arquivado"
        sub={`“${archived.name}” está arquivado e fora das listagens ativas.`}
      >
        <button type="button" className="btn btn-primary" onClick={() => act.restoreProject(archived.id)}>
          <Icon name="refresh" size={14} />
          Restaurar
        </button>
      </Empty>
    );
  if (!p)
    return (
      <Empty
        icon="shield"
        title="Acesso indisponível"
        sub="O projeto não foi encontrado ou não está disponível para o seu perfil."
      />
    );
  const tasks = db.tasks.filter((t) => t.projectId === id && !t.parentId);
  const progress = projectProgress(db, id);
  const left = daysLeft(p.targetDate);
  const epics = db.epics.filter((e) => e.projectId === id);
  const milestones = db.milestones.filter((m) => m.projectId === id);
  const acts = db.audit.filter((a) => a.projectId === id && a.action !== "denied").slice(0, 7);
  const newEpic = (label: string) =>
    can("task.create", id) && (
      <button type="button" className="btn btn-sm" onClick={() => setEpic(true)}>
        <Icon name="plus" size={12} />
        {label}
      </button>
    );

  return (
    <>
      <PageHead
        title={
          <>
            <ProjectDot project={p} lg />
            {p.name}
          </>
        }
        sub={p.desc}
      >
        <button
          type="button"
          className="btn"
          onClick={() => {
            act.setCurrentProject(id);
            navigate("/board");
          }}
        >
          <Icon name="board" size={14} />
          Kanban
        </button>
        {can("task.create", id) && (
          <button type="button" className="btn btn-primary" onClick={() => ui.task({ projectId: id })}>
            <Icon name="plus" size={14} />
            Nova tarefa
          </button>
        )}
        <ProjectMenu p={p} />
      </PageHead>
      <div className="meta-row">
        <MetaItem k="Status">
          <ProjectStatusChip p={p} />
        </MetaItem>
        <MetaItem k="Prioridade">
          <PriorityChip priority={p.priority} />
        </MetaItem>
        <MetaItem k="Risco">
          <RiskChip p={p} />
        </MetaItem>
        <MetaItem k="Responsável">
          <Who id={p.leadId} />
        </MetaItem>
        <MetaItem k="Chave">
          <span className="mono">{p.key}</span>
        </MetaItem>
        <MetaItem k="Período">
          <span className="num">
            {fmtDate(p.startDate)} → {fmtDate(p.targetDate)}
            {left !== null && p.status !== "done" && (
              <span className={left < 0 ? "text-danger" : "subtle"}>
                {" · "}
                {left < 0 ? `${-left}d de atraso` : `${left}d restantes`}
              </span>
            )}
          </span>
        </MetaItem>
        <MetaItem k="Progresso" grow>
          <Progress value={progress} label={`Progresso de ${p.name}`} />
          <span className="num" aria-hidden="true">
            {progress}%
          </span>
        </MetaItem>
      </div>
      <TabNav
        label="Seções do projeto"
        base={`/projects/${id}/`}
        active={tab}
        items={[
          { key: "overview", label: "Visão geral" },
          { key: "tasks", label: `Tarefas (${tasks.length})` },
          { key: "members", label: "Membros" },
          { key: "settings", label: "Configurações" },
        ]}
      />
      {tab === "overview" && (
        <div className="grid c2">
          <div className="panel">
            <div className="panel-head">
              <h2>Épicos</h2>
              <span className="spacer" />
              {newEpic("Épico")}
            </div>
            <div className="panel-body flush prog-list">
              {!epics.length && (
                <Empty
                  inline
                  icon="epic"
                  title="Nenhum épico neste projeto"
                  sub="Épicos agrupam tarefas de uma mesma entrega."
                >
                  {newEpic("Novo épico")}
                </Empty>
              )}
              {epics.map((ep) => {
                const ts = tasks.filter((t) => t.epicId === ep.id);
                const done = ts.filter((t) => t.status === "done").length;
                const pct = ts.length ? Math.round((100 * done) / ts.length) : 0;
                return (
                  <div className="prog-block" key={ep.id}>
                    <div className="pb-head">
                      <TypeIcon type="epic" decorative />
                      <b>{ep.name}</b>
                      <span className="pb-num">
                        {done}/{ts.length} · {pct}%
                      </span>
                    </div>
                    <Progress value={pct} label={`Progresso do épico ${ep.name}`} />
                    {ep.desc && <div className="pb-foot">{ep.desc}</div>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="stack">
            <div className="panel">
              <div className="panel-head">
                <h2>Marcos de entrega</h2>
              </div>
              <div className="panel-body">
                {milestones.length ? (
                  <div className="timeline">
                    {milestones.map((m) => {
                      const late = m.status !== "done" && (daysLeft(m.date) ?? 0) < 0;
                      return (
                        <div className="hist-item" key={m.id}>
                          <span
                            className={`tl-node ${m.status === "done" ? "accent" : late ? "danger" : "violet"}`}
                            aria-hidden="true"
                          >
                            <Icon name={m.status === "done" ? "check" : "target"} size={12} />
                          </span>
                          <span className="tl-txt">
                            <b>{m.name}</b>
                          </span>
                          {m.status === "done" ? (
                            <span className="chip ok">Entregue</span>
                          ) : (
                            late && <span className="chip danger">Atrasado</span>
                          )}
                          <time dateTime={m.date}>{fmtDate(m.date)}</time>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Empty
                    inline
                    icon="target"
                    title="Nenhum marco cadastrado"
                    sub="Os marcos de entrega do projeto aparecem aqui e no Cronograma."
                  />
                )}
              </div>
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Atividade do projeto</h2>
              </div>
              <div className="panel-body">
                {acts.length ? (
                  <ActivityFeed entries={acts} />
                ) : (
                  <Empty
                    inline
                    icon="pulse"
                    title="Sem atividade ainda"
                    sub="As ações feitas neste projeto aparecem aqui."
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {tab === "tasks" && <TaskTable projectId={id} />}
      {tab === "members" && (
        <>
          <div className="grid c2">
            {p.teamIds.map((tid) => {
              const tm = db.teams.find((t) => t.id === tid);
              if (!tm) return null;
              return (
                <div className="panel" key={tid}>
                  <div className="panel-head">
                    <h2>{tm.name}</h2>
                    <span className="spacer" />
                    <span className="chip">{plural(tm.memberIds.length, "membro", "membros")}</span>
                  </div>
                  <div className="panel-body flush list">
                    {tm.memberIds.map((uid) => {
                      const u = db.users.find((x) => x.id === uid);
                      if (!u) return null;
                      return (
                        <div className="list-item member-row" key={uid}>
                          <Avatar user={u} decorative />
                          <span className="li-main">
                            <span className="li-title">{u.name}</span>
                            <span className="li-meta">{u.title}</span>
                          </span>
                          <span className="li-trail">
                            {tm.leadId === u.id && <span className="chip accent">Líder</span>}
                            <span className="chip">{roles[u.roleId]}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {!p.teamIds.length && (
              <Empty
                icon="users"
                title="Sem equipes associadas"
                sub="Edite o projeto para associar equipes."
              />
            )}
          </div>
          <p className="page-note">
            Uma pessoa pode pertencer a mais de uma equipe e ter papéis de acesso diferentes. O papel (coluna
            à direita) define o que ela pode fazer; o cargo descreve a função.
          </p>
        </>
      )}
      {tab === "settings" &&
        (can("project.edit", id) ? (
          <div className="stack narrow">
            <div className="panel">
              <div className="panel-head">
                <h2>Configurações do projeto</h2>
              </div>
              <div className="panel-body">
                <p className="muted">Edite nome, descrição, datas, prioridade e equipes.</p>
                <button type="button" className="btn" onClick={() => ui.project(p)}>
                  <Icon name="edit" size={14} />
                  Editar projeto
                </button>
              </div>
            </div>
            {can("project.archive") && (
              <div className="panel danger">
                <div className="panel-head">
                  <h2>Zona de risco</h2>
                </div>
                <div className="panel-body">
                  <p className="muted">
                    Arquivar tira o projeto das listagens ativas; é possível restaurá-lo depois.
                  </p>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        ui.confirm({
                          title: "Arquivar projeto",
                          message: `O projeto “${p.name}” sai das listagens ativas. É possível restaurá-lo depois.`,
                          label: "Arquivar",
                          danger: true,
                          action: () => act.archiveProject(id),
                        })
                      }
                    >
                      <Icon name="archive" size={14} />
                      Arquivar projeto
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <NoAccess what="às configurações do projeto" />
        ))}
      {epic && <EpicModal project={p} onClose={() => setEpic(false)} />}
    </>
  );
}

/* ==========================================================================
   Novo épico (modal)
   ========================================================================== */
function EpicModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { db, act, notify } = useWorkspace();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const value = name.trim();
    if (!value) {
      setError("Informe o nome");
      return;
    }
    const taken = db.epics.some(
      (e) => e.projectId === project.id && e.name.trim().toLowerCase() === value.toLowerCase(),
    );
    if (taken) {
      setError("Já existe um épico com esse nome neste projeto");
      return;
    }
    setBusy(true);
    const created = await act.createEpic(project.id, { name: value, desc: desc.trim() });
    setBusy(false);
    if (!created) return;
    onClose();
    notify("Épico criado", value, "ok");
  };
  return (
    <Overlay
      title={`Novo épico em ${project.name}`}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            Criar épico
          </button>
        </>
      }
    >
      <Field label="Nome do épico" required error={error}>
        <input
          className="input"
          maxLength={70}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
        />
      </Field>
      <Field label="Descrição">
        <textarea className="textarea" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </Field>
    </Overlay>
  );
}
