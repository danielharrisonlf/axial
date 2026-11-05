import { useState } from "react";
import { Icon } from "../components/Icon";
import { TaskTable } from "../components/Tasks";
import {
  Avatar,
  Empty,
  Field,
  MenuButton,
  Overlay,
  PageHead,
  PriorityChip,
  Progress,
  ProjectStatus,
  Risk,
  roles,
  Select,
  TypeIcon,
  useUI,
  Who,
} from "../components/ui";
import type { Project } from "../data/types";
import { useWorkspace } from "../data/workspace";
import { fmtDate, navigate, projectProgress, rel } from "../lib/format";
export function ProjectMenu({ p }: { p: Project }) {
  const { can, act } = useWorkspace(),
    ui = useUI();
  return (
    <MenuButton
      label="Ações do projeto"
      items={[
        { label: "Abrir projeto", icon: "external", onClick: () => navigate(`/projects/${p.id}`) },
        {
          label: "Abrir Kanban",
          icon: "board",
          onClick: () => {
            act.setCurrentProject(p.id);
            navigate("/board");
          },
        },
        ...(can("project.edit") ? [{ label: "Editar", icon: "edit", onClick: () => ui.project(p) }] : []),
        ...(can("project.archive")
          ? [
              {
                label: p.archived ? "Restaurar" : "Arquivar",
                icon: "archive",
                onClick: () =>
                  p.archived
                    ? act.restoreProject(p.id)
                    : ui.confirm(
                        "Arquivar projeto",
                        `O projeto “${p.name}” sai das listagens ativas. É possível restaurá-lo depois (simulação).`,
                        () => act.archiveProject(p.id),
                        "Arquivar",
                      ),
              },
            ]
          : []),
      ]}
    >
      <Icon name="dots" size={15} />
    </MenuButton>
  );
}
export function Projects() {
  const { db, visibleProjects, accessibleProjects, can, act } = useWorkspace(),
    ui = useUI();
  const [q, setQ] = useState(""),
    [status, setStatus] = useState("");
  const list = (
    status === "archived" ? accessibleProjects.filter((p) => p.archived) : visibleProjects
  ).filter(
    (p) =>
      (!status || status === "archived" || p.status === status) &&
      (!q || `${p.name} ${p.key}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
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
        <Select
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: "Todos os status" },
            { value: "active", label: "Ativo" },
            { value: "paused", label: "Pausado" },
            { value: "done", label: "Concluído" },
            ...(can("project.archive") ? [{ value: "archived", label: "Arquivados" }] : []),
          ]}
        />
      </div>
      {!list.length ? (
        <Empty
          icon="folders"
          title="Nenhum projeto encontrado"
          sub="Ajuste os filtros ou crie um novo projeto."
        />
      ) : (
        <div className="panel">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 30 }} />
                  <th>Projeto</th>
                  <th>Status</th>
                  <th>Prioridade</th>
                  <th>Progresso</th>
                  <th>Equipes</th>
                  <th>Responsável</th>
                  <th>Entrega</th>
                  <th>Risco</th>
                  <th className="actions-col" />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="row-click" onClick={() => navigate(`/projects/${p.id}`)}>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        style={p.favorite ? { color: "var(--warn)" } : undefined}
                        aria-label={p.favorite ? "Remover dos favoritos" : "Favoritar"}
                        aria-pressed={p.favorite}
                        onClick={(e) => {
                          e.stopPropagation();
                          act.toggleFavorite(p.id);
                        }}
                      >
                        <Icon name="star" size={14} />
                      </button>
                    </td>
                    <td>
                      <div className="inline-row">
                        <span className="dot" style={{ background: p.color }} />
                        <div>
                          <button
                            type="button"
                            className="row-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/projects/${p.id}`);
                            }}
                          >
                            <b>{p.name}</b>
                          </button>
                          <div className="mono subtle">{p.key}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <ProjectStatus p={p} />
                    </td>
                    <td>
                      <PriorityChip priority={p.priority} />
                    </td>
                    <td>
                      <div className="inline-row">
                        <Progress value={projectProgress(db, p.id)} />
                        <span className="num muted" style={{ fontSize: 11.5 }}>
                          {projectProgress(db, p.id)}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="avatar-stack">
                        {p.teamIds.slice(0, 3).map((id) => {
                          const tm = db.teams.find((t) => t.id === id);
                          return (
                            <span
                              key={id}
                              className="avatar sm"
                              style={{ background: "var(--ink-3)" }}
                              data-tip={tm?.name}
                            >
                              {tm?.name.slice(0, 2).toUpperCase() || "?"}
                            </span>
                          );
                        })}
                      </span>
                    </td>
                    <td>
                      <Who id={p.leadId} />
                    </td>
                    <td className="nowrap">{fmtDate(p.targetDate)}</td>
                    <td>
                      <Risk p={p} />
                    </td>
                    <td className="actions-col">
                      <ProjectMenu p={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
export function ProjectDetail({ id, tab = "overview" }: { id: string; tab?: string }) {
  const { db, visibleProjects, accessibleProjects, can, act } = useWorkspace(),
    ui = useUI();
  const [epic, setEpic] = useState(false),
    [epName, setEpName] = useState(""),
    [epDesc, setEpDesc] = useState("");
  const p =
    visibleProjects.find((x) => x.id === id) ||
    accessibleProjects.find((x) => x.id === id && x.archived && can("project.archive"));
  if (!p)
    return (
      <Empty
        icon="shield"
        title="Acesso indisponível"
        sub="O projeto não foi encontrado ou não está disponível para o seu perfil."
      />
    );
  const tasks = db.tasks.filter((t) => t.projectId === id && !t.parentId),
    progress = projectProgress(db, id);
  return (
    <>
      <PageHead title={p.name} sub={p.desc}>
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
        {can("task.create") && (
          <button type="button" className="btn btn-primary" onClick={() => ui.task({ projectId: id })}>
            <Icon name="plus" size={14} />
            Nova tarefa
          </button>
        )}
        <ProjectMenu p={p} />
      </PageHead>
      <div className="fbar" style={{ gap: 10 }}>
        <ProjectStatus p={p} />
        <PriorityChip priority={p.priority} />
        <Risk p={p} />
        <span className="chip">
          <span className="mono">{p.key}</span>
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          Início {fmtDate(p.startDate)} · Entrega {fmtDate(p.targetDate)}
        </span>
        <span className="inline-row">
          <Progress value={progress} />
          <span className="num muted" style={{ fontSize: 12 }}>
            {progress}%
          </span>
        </span>
      </div>
      <div className="tabs" role="tablist" aria-label="Seções do projeto">
        {[
          ["overview", "Visão geral"],
          ["tasks", `Tarefas (${tasks.length})`],
          ["members", "Membros"],
          ["settings", "Configurações"],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`tab${tab === key ? " active" : ""}`}
            onClick={() => navigate(`/projects/${id}/${key}`)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <div className="grid c2">
          <div className="panel">
            <div className="panel-head">
              <h3>Épicos</h3>
              <span className="spacer" />
              {can("task.create") && (
                <button type="button" className="btn btn-sm" onClick={() => setEpic(true)}>
                  <Icon name="plus" size={12} />
                  Épico
                </button>
              )}
            </div>
            <div className="panel-body">
              {!db.epics.some((e) => e.projectId === id) && (
                <p className="muted">Nenhum épico neste projeto.</p>
              )}
              {db.epics
                .filter((e) => e.projectId === id)
                .map((ep) => {
                  const ts = tasks.filter((t) => t.epicId === ep.id),
                    done = ts.filter((t) => t.status === "done").length;
                  return (
                    <div key={ep.id} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 4 }}>
                        <TypeIcon type="epic" />
                        <b>{ep.name}</b>
                        <span className="grow" />
                        <span className="num muted" style={{ fontSize: 11.5 }}>
                          {done}/{ts.length}
                        </span>
                      </div>
                      <Progress value={ts.length ? Math.round((100 * done) / ts.length) : 0} />
                      <div className="subtle" style={{ fontSize: 11.5, marginTop: 3 }}>
                        {ep.desc}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
          <div className="grid stack-start">
            <div className="panel">
              <div className="panel-head">
                <h3>Marcos de entrega</h3>
              </div>
              <div className="panel-body">
                {!db.milestones.some((m) => m.projectId === id) && (
                  <p className="muted">Nenhum marco cadastrado.</p>
                )}
                {db.milestones
                  .filter((m) => m.projectId === id)
                  .map((m) => (
                    <div className="hist-item" key={m.id}>
                      <span style={{ color: m.status === "done" ? "var(--ok)" : "var(--violet)" }}>
                        <Icon name="target" size={15} />
                      </span>
                      <span className="grow">{m.name}</span>
                      {m.status === "done" && <span className="chip ok">entregue</span>}
                      <time>{fmtDate(m.date)}</time>
                    </div>
                  ))}
              </div>
            </div>
            <div className="panel">
              <div className="panel-head">
                <h3>Atividade do projeto</h3>
              </div>
              <div className="panel-body">
                {db.audit
                  .filter((a) => a.projectId === id && a.action !== "denied")
                  .slice(0, 7)
                  .map((a) => {
                    const u = db.users.find((x) => x.id === a.userId);
                    return (
                      <div className="hist-item" key={a.id}>
                        <Avatar user={u} size="sm" />
                        <span>
                          <b>{u?.name || "?"}</b> {a.summary}
                        </span>
                        <time>{rel(a.ts)}</time>
                      </div>
                    );
                  })}
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
              return (
                tm && (
                  <div className="panel" key={tid}>
                    <div className="panel-head">
                      <h3>{tm.name}</h3>
                      <span className="spacer" />
                      <span className="chip">{tm.memberIds.length} pessoas</span>
                    </div>
                    <div className="panel-body">
                      {tm.memberIds.map((uid) => {
                        const u = db.users.find((x) => x.id === uid);
                        return (
                          u && (
                            <div key={uid} className="hist-item">
                              <Avatar user={u} size="sm" />
                              <span className="grow">
                                {u.name}
                                <span className="subtle"> — {u.title}</span>
                              </span>
                              {tm.leadId === uid && <span className="chip accent">líder</span>}
                              <span className="chip">{roles[u.roleId]}</span>
                            </div>
                          )
                        );
                      })}
                    </div>
                  </div>
                )
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
          <p className="subtle" style={{ marginTop: 10, fontSize: 12 }}>
            Uma pessoa pode pertencer a mais de uma equipe e ter papéis de acesso diferentes. O papel (coluna
            à direita) define o que ela pode fazer; o cargo descreve a função.
          </p>
        </>
      )}
      {tab === "settings" &&
        (can("project.edit") ? (
          <>
            <div className="panel" style={{ maxWidth: 720 }}>
              <div className="panel-head">
                <h3>Configurações do projeto</h3>
              </div>
              <div className="panel-body">
                <p className="muted">Edite nome, descrição, datas, prioridade e equipes.</p>
                <button type="button" className="btn" onClick={() => ui.project(p)}>
                  <Icon name="edit" size={14} />
                  Editar projeto
                </button>
              </div>
            </div>
            <div className="panel" style={{ maxWidth: 720, marginTop: 14, borderColor: "var(--danger)" }}>
              <div className="panel-head">
                <h3 style={{ color: "var(--danger)" }}>Zona de risco</h3>
              </div>
              <div className="panel-body">
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    ui.confirm(
                      "Arquivar projeto",
                      "O projeto sai das listagens ativas.",
                      () => act.archiveProject(id),
                      "Arquivar",
                    )
                  }
                >
                  <Icon name="archive" size={14} />
                  Arquivar projeto
                </button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            icon="shield"
            title="Acesso restrito"
            sub="O seu perfil não permite editar configurações do projeto."
          />
        ))}
      {epic && (
        <Overlay
          title={`Novo épico em ${p.name}`}
          onClose={() => setEpic(false)}
          foot={
            <>
              <button type="button" className="btn" onClick={() => setEpic(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (epName.trim()) {
                    act.createEpic(id, { name: epName.trim(), desc: epDesc.trim() });
                    setEpic(false);
                    setEpName("");
                    setEpDesc("");
                  }
                }}
              >
                Criar épico
              </button>
            </>
          }
        >
          <Field label="Nome do épico">
            <input
              className="input"
              aria-label="Nome do épico"
              maxLength={70}
              value={epName}
              onChange={(e) => setEpName(e.target.value)}
            />
          </Field>
          <Field label="Descrição">
            <textarea
              className="textarea"
              aria-label="Descrição do épico"
              value={epDesc}
              onChange={(e) => setEpDesc(e.target.value)}
            />
          </Field>
        </Overlay>
      )}
    </>
  );
}
