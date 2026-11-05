import { type ReactNode, useState } from "react";
import { Icon } from "../components/Icon";
import { TaskRow } from "../components/Tasks";
import { Avatar, Empty, PageHead, Progress, Select, useUI } from "../components/ui";
import { useWorkspace } from "../data/workspace";
import { daysLeft, fmtDate, isOverdue, navigate, projectProgress, projectRisk, rel } from "../lib/format";

function Panel({
  title,
  action,
  flush = false,
  children,
}: {
  title: string;
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {action && (
          <>
            <span className="spacer" />
            {action}
          </>
        )}
      </div>
      <div className={`panel-body${flush ? " flush" : ""}`}>{children}</div>
    </div>
  );
}
export function Dashboard() {
  const { db, me, visibleProjects: projects, visibleTasks, can } = useWorkspace(),
    ui = useUI();
  const [period, setPeriod] = useState("30"),
    [project, setProject] = useState(""),
    [team, setTeam] = useState(""),
    [assignee, setAssignee] = useState("");
  const tasks = visibleTasks.filter(
      (t) =>
        !t.parentId &&
        (!project || t.projectId === project) &&
        (!team || t.teamId === team) &&
        (!assignee || t.assigneeId === assignee),
    ),
    cutoff = Date.now() - Number(period) * 86400000;
  const activeProjects = projects.filter((p) => p.status === "active" && (!project || p.id === project)),
    mine = tasks.filter((t) => t.assigneeId === me.id && t.status !== "done"),
    late = tasks.filter(isOverdue),
    next = tasks.filter((t) => {
      const d = daysLeft(t.dueDate);
      return t.status !== "done" && d !== null && d >= 0 && d <= 7;
    }),
    activeSprints = db.sprints.filter(
      (s) =>
        s.status === "active" &&
        projects.some((p) => p.id === s.projectId) &&
        (!project || s.projectId === project),
    ),
    done = tasks.filter((t) => t.status === "done" && new Date(t.updatedAt).getTime() >= cutoff),
    upcoming = tasks
      .filter((t) => t.status !== "done" && t.dueDate && (daysLeft(t.dueDate) ?? -999) >= -30)
      .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))
      .slice(0, 6),
    audit = db.audit
      .filter(
        (a) =>
          (!a.projectId || projects.some((p) => p.id === a.projectId)) &&
          (!project || a.projectId === project) &&
          new Date(a.ts).getTime() >= cutoff &&
          a.action !== "denied",
      )
      .slice(0, 8);
  const stats = [
    {
      label: "Projetos ativos",
      value: activeProjects.length,
      ctx: `${projects.filter((p) => projectRisk(db, p).level === "high").length} em risco`,
      cls: "bad",
      path: "/projects",
    },
    {
      label: "Minhas tarefas abertas",
      value: mine.length,
      ctx: `${mine.filter(isOverdue).length} atrasadas`,
      cls: mine.some(isOverdue) ? "bad" : "",
      path: "/my-tasks",
    },
    {
      label: "Tarefas atrasadas",
      value: late.length,
      ctx: "no recorte atual",
      cls: late.length ? "bad" : "good",
    },
    { label: "Entregas em 7 dias", value: next.length, ctx: "com prazo definido" },
    { label: "Concluídas no período", value: done.length, ctx: `últimos ${period} dias`, cls: "good" },
  ];
  return (
    <>
      <PageHead
        title={`Bom dia, ${me.name.split(" ")[0]}`}
        sub={`Visão operacional de ${projects.length} projeto(s) visíveis para o seu perfil.`}
      >
        {can("task.create") && (
          <button type="button" className="btn" onClick={() => ui.task()}>
            <Icon name="plus" size={14} />
            Nova tarefa
          </button>
        )}
        {can("project.create") && (
          <button type="button" className="btn btn-primary" onClick={() => ui.project()}>
            <Icon name="plus" size={14} />
            Novo projeto
          </button>
        )}
      </PageHead>
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
            ...projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <Select
          label="Equipe"
          value={team}
          onChange={setTeam}
          options={[
            { value: "", label: "Todas as equipes" },
            ...db.teams.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
        <Select
          label="Responsável"
          value={assignee}
          onChange={setAssignee}
          options={[
            { value: "", label: "Todos os responsáveis" },
            ...db.users.filter((u) => !u.invited).map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
        {(project || team || assignee) && (
          <button
            type="button"
            className="btn btn-ghost btn-sm clear-f"
            onClick={() => {
              setProject("");
              setTeam("");
              setAssignee("");
            }}
          >
            <Icon name="x" size={12} />
            Limpar filtros
          </button>
        )}
      </div>
      <div className="stat-strip" style={{ marginBottom: 14 }}>
        {stats.map((s) =>
          s.path ? (
            <a key={s.label} className="stat clickable" href={`#${s.path}`}>
              <div className="lbl">{s.label}</div>
              <div className="val">{s.value}</div>
              <div className={`ctx ${s.cls || ""}`}>{s.ctx}</div>
            </a>
          ) : (
            <div key={s.label} className="stat">
              <div className="lbl">{s.label}</div>
              <div className="val">{s.value}</div>
              <div className={`ctx ${s.cls || ""}`}>{s.ctx}</div>
            </div>
          ),
        )}
      </div>
      <div className="grid c2-1">
        <div className="grid stack-start">
          <Panel
            title="Minhas tarefas"
            flush
            action={
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("/my-tasks")}>
                Ver todas
                <Icon name="arrowR" size={12} />
              </button>
            }
          >
            {mine.length ? (
              mine
                .sort((a, b) => (a.dueDate || "9").localeCompare(b.dueDate || "9"))
                .slice(0, 6)
                .map((t) => <TaskRow key={t.id} task={t} />)
            ) : (
              <Empty title="Nada atribuído a você" sub="Tarefas atribuídas ao seu perfil aparecem aqui." />
            )}
          </Panel>
          <Panel
            title="Próximas entregas"
            flush
            action={<span className="chip">{next.length} em 7 dias</span>}
          >
            {upcoming.length ? (
              upcoming.map((t) => <TaskRow key={t.id} task={t} withDue />)
            ) : (
              <Empty
                icon="calendar"
                title="Sem prazos no recorte"
                sub="Defina datas de vencimento nas tarefas para acompanhá-las aqui."
              />
            )}
          </Panel>
          <Panel
            title="Atividades recentes"
            action={
              can("audit.view") ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-disabled="true"
                  title="Auditoria estará disponível em uma próxima etapa"
                >
                  Auditoria
                  <Icon name="arrowR" size={12} />
                </button>
              ) : undefined
            }
          >
            {!audit.length && <p className="muted">Nenhuma atividade no período.</p>}
            {audit.map((a) => {
              const u = db.users.find((u) => u.id === a.userId);
              return (
                <div key={a.id} className="hist-item">
                  <Avatar user={u} size="sm" />
                  <span>
                    <b>{u?.name || "?"}</b> {a.summary}
                  </span>
                  <time>{rel(a.ts)}</time>
                </div>
              );
            })}
          </Panel>
        </div>
        <div className="grid stack-start">
          <Panel
            title="Sprints ativas"
            action={
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("/sprints")}>
                Sprints
                <Icon name="arrowR" size={12} />
              </button>
            }
          >
            {!activeSprints.length && <p className="muted">Nenhuma sprint ativa no recorte.</p>}
            {activeSprints.map((s) => {
              const ts = db.tasks.filter((t) => t.sprintId === s.id && !t.parentId),
                done = ts.filter((t) => t.status === "done").length;
              return (
                <div key={s.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
                    <b>{s.name}</b>
                    <span className="subtle" style={{ fontSize: 11 }}>
                      {db.projects.find((p) => p.id === s.projectId)?.name}
                    </span>
                    <span className="grow" />
                    <span className="num muted" style={{ fontSize: 12 }}>
                      {done}/{ts.length}
                    </span>
                  </div>
                  <Progress value={ts.length ? Math.round((100 * done) / ts.length) : 0} />
                  <div className="subtle" style={{ fontSize: 11, marginTop: 3 }}>
                    termina {fmtDate(s.endDate)}
                  </div>
                </div>
              );
            })}
          </Panel>
          <Panel title="Projetos favoritos" flush>
            {!projects.some((p) => p.favorite) && (
              <div className="panel-body">
                <p className="muted" style={{ margin: 0 }}>
                  Marque projetos com a estrela para fixá-los aqui.
                </p>
              </div>
            )}
            {projects
              .filter((p) => p.favorite)
              .map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="menu-item"
                  style={{ borderRadius: 0, padding: "10px 14px" }}
                  onClick={() => navigate(`/projects/${p.id}`)}
                >
                  <span className="dot" style={{ background: p.color }} />
                  <span className="grow">
                    {p.name}
                    <span className="mi-sub">
                      {p.key} · {projectProgress(db, p.id)}% concluído
                    </span>
                  </span>
                  <Icon name="chevR" size={14} />
                </button>
              ))}
          </Panel>
          <div className="panel">
            <div className="panel-head">
              <h3>Resumo por equipe</h3>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Equipe</th>
                    <th className="num">Abertas</th>
                    <th className="num">Atrasadas</th>
                  </tr>
                </thead>
                <tbody>
                  {db.teams.map((tm) => {
                    const ts = tasks.filter((t) => t.teamId === tm.id && t.status !== "done"),
                      late = ts.filter(isOverdue).length;
                    return !ts.length && team && team !== tm.id ? null : (
                      <tr key={tm.id}>
                        <td>{tm.name}</td>
                        <td className="num">{ts.length}</td>
                        <td className="num">
                          <span style={late ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
                            {late}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
