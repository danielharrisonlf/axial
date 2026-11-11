import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { Empty, PageHead, Select, Who } from "../components/ui";
import { useWorkspace } from "../data/workspace";
import { fmtDateTime, navigate } from "../lib/format";

const ACTOR_ROLES = new Set(["admin", "pm", "lead"]);
const ACTION_LABEL: Record<string, string> = {
  create: "Criou",
  update: "Atualizou",
  status: "Mudou status",
  archive: "Arquivou",
  restore: "Restaurou",
  delete: "Excluiu",
  comment: "Comentou",
  sprint_start: "Iniciou sprint",
  sprint_end: "Encerrou sprint",
  denied: "Acesso negado",
};
const ENTITY_LABEL: Record<string, string> = {
  project: "Projeto",
  epic: "Épico",
  task: "Tarefa",
  sprint: "Sprint",
  milestone: "Marco",
  notification: "Notificação",
};

function Summary({
  label,
  value,
  context,
  tone,
}: {
  label: string;
  value: number;
  context: string;
  tone?: string;
}) {
  return (
    <div className="stat">
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      <div className={`ctx ${tone ?? ""}`}>{context}</div>
    </div>
  );
}

export function Audit() {
  const { db, me, can, accessibleProjects } = useWorkspace();
  const [project, setProject] = useState("");
  const [actor, setActor] = useState("");
  const [event, setEvent] = useState("");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("30");

  const allowed = ACTOR_ROLES.has(me.roleId) && can("audit.view");
  const projectIds = useMemo(() => new Set(accessibleProjects.map((p) => p.id)), [accessibleProjects]);

  const entries = useMemo(() => {
    if (!allowed) return [];
    const cutoff = Date.now() - Number(period) * 86_400_000;
    const query = search.trim().toLowerCase();
    return db.audit.filter(
      (entry) =>
        new Date(entry.ts).getTime() >= cutoff &&
        (!entry.projectId || projectIds.has(entry.projectId)) &&
        (!project || entry.projectId === project) &&
        (!actor || entry.userId === actor) &&
        (!event || entry.action === event) &&
        (!query ||
          `${entry.summary} ${entry.entityType} ${entry.entityId ?? ""}`.toLowerCase().includes(query)),
    );
  }, [allowed, db.audit, project, actor, event, search, period, projectIds]);

  const actors = useMemo(() => new Set(entries.map((entry) => entry.userId)).size, [entries]);
  const actions = useMemo(() => {
    const options = new Set<string>();
    for (const entry of db.audit) options.add(entry.action);
    return [...options].sort();
  }, [db.audit]);

  if (!allowed) {
    return (
      <>
        <PageHead title="Trilha de auditoria" sub="Registro imutável de alterações da organização." />
        <Empty
          icon="shield"
          title="Acesso restrito"
          sub="A trilha de auditoria é visível para administradores, gestores de projetos e líderes de equipe."
        />
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Trilha de auditoria"
        sub="Registro imutável de alterações, restrito à organização e aos projetos que o seu perfil pode ver."
      >
        <button type="button" className="btn btn-ghost" onClick={() => navigate("/settings")}>
          <Icon name="settings" size={14} />
          Configurações
        </button>
      </PageHead>
      <div className="stat-strip" style={{ marginBottom: 14 }}>
        <Summary label="Eventos no período" value={entries.length} context={`últimos ${period} dias`} />
        <Summary label="Pessoas envolvidas" value={actors} context="autores distintos" />
        <Summary
          label="Projetos afetados"
          value={new Set(entries.map((entry) => entry.projectId).filter(Boolean)).size}
          context="com alterações"
        />
        <Summary
          label="Alterações de tarefa"
          value={entries.filter((entry) => entry.entityType === "task").length}
          context="criação, edição e status"
        />
      </div>
      <div className="fbar">
        <Select
          label="Período"
          value={period}
          onChange={setPeriod}
          options={["7", "14", "30", "90"].map((value) => ({ value, label: `Últimos ${value} dias` }))}
        />
        <Select
          label="Projeto"
          value={project}
          onChange={setProject}
          options={[
            { value: "", label: "Todos os projetos" },
            ...accessibleProjects.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <Select
          label="Autor"
          value={actor}
          onChange={setActor}
          options={[
            { value: "", label: "Todas as pessoas" },
            ...db.users.filter((u) => !u.invited).map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
        <Select
          label="Ação"
          value={event}
          onChange={setEvent}
          options={[
            { value: "", label: "Todas as ações" },
            ...actions.map((value) => ({ value, label: ACTION_LABEL[value] ?? value })),
          ]}
        />
        <label className="input-wrap" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="search" size={13} />
          <input
            className="input"
            type="search"
            aria-label="Buscar na auditoria"
            placeholder="Buscar no resumo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>Eventos</h3>
          <span className="spacer" />
          <span className="chip">{entries.length}</span>
        </div>
        <div className="panel-body flush">
          {entries.length === 0 ? (
            <Empty icon="scroll" title="Nenhum evento" sub="Ajuste os filtros para ver outras alterações." />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Autor</th>
                    <th>Ação</th>
                    <th>Entidade</th>
                    <th>Projeto</th>
                    <th>Resumo</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const target = accessibleProjects.find((p) => p.id === entry.projectId);
                    return (
                      <tr key={entry.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(entry.ts)}</td>
                        <td>
                          <Who id={entry.userId} />
                        </td>
                        <td>
                          <span className="chip">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                        </td>
                        <td>
                          {ENTITY_LABEL[entry.entityType] ?? entry.entityType}
                          {entry.entityId && <span className="subtle"> · {entry.entityId.slice(0, 8)}</span>}
                        </td>
                        <td>
                          {target ? (
                            <button
                              type="button"
                              className="row-link"
                              onClick={() => navigate(`/projects/${target.id}`)}
                            >
                              {target.name}
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>{entry.summary}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
