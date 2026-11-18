import { useState } from "react";
import { Icon } from "../components/Icon";
import {
  ActivityFeed,
  Empty,
  FilterSelect,
  PageHead,
  Progress,
  ProjectDot,
  Stat,
  TaskRow,
  useUI,
} from "../components/ui";
import type { AuditEntry, Task } from "../data/types";
import { useWorkspace } from "../data/workspace";
import { daysLeft, fmtDate, isOverdue, plural, projectProgress, projectRisk } from "../lib/format";

const DAY = 86400000;
/** Audit entities without a project that only auditors see on the home page. */
const ADMIN_ENTITIES = ["user", "webhook", "notification", "permission", "mcp", "ai"];
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const greeting = (hour: number) => (hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite");
/** Completion instant (doneAt), or NaN when the task is open or has no record. */
const doneTs = (t: Task) => (t.status === "done" && t.doneAt ? new Date(t.doneAt).getTime() : Number.NaN);

export function Dashboard() {
  const { db, me, visibleProjects: projects, visibleTasks, can, isFavorite } = useWorkspace();
  const ui = useUI();
  const [period, setPeriod] = useState("30");
  const [projectF, setProject] = useState("");
  const [teamF, setTeam] = useState("");
  const [assigneeF, setAssignee] = useState("");

  // the organization scope follows the profile: admin and viewer see every organization
  const inScope = (orgId: string) => me.roleId === "admin" || me.roleId === "viewer" || orgId === me.orgId;
  const teams = db.teams.filter((t) => inScope(t.orgId));
  const people = db.users.filter((u) => inScope(u.orgId) && !u.invited);
  // a filter that no longer exists for the current profile is ignored
  const project = projects.some((p) => p.id === projectF) ? projectF : "";
  const team = teams.some((t) => t.id === teamF) ? teamF : "";
  const assignee = people.some((u) => u.id === assigneeF) ? assigneeF : "";
  const days = Number(period);

  const tasks = visibleTasks.filter(
    (t) =>
      !t.parentId &&
      (!project || t.projectId === project) &&
      (!team || t.teamId === team) &&
      (!assignee || t.assigneeId === assignee),
  );
  const cutoff = Date.now() - days * DAY;
  const activeProjects = projects.filter((p) => p.status === "active" && (!project || p.id === project));
  const myOpen = tasks.filter((t) => t.assigneeId === me.id && t.status !== "done");
  const late = tasks.filter(isOverdue);
  const next7 = tasks.filter((t) => {
    const d = daysLeft(t.dueDate);
    return t.status !== "done" && d !== null && d >= 0 && d <= 7;
  });
  const activeSprints = db.sprints.filter(
    (s) =>
      s.status === "active" &&
      projects.some((p) => p.id === s.projectId) &&
      (!project || s.projectId === project),
  );
  const doneInPeriod = tasks.filter((t) => doneTs(t) >= cutoff);
  const donePrev = tasks.filter((t) => {
    const x = doneTs(t);
    return x >= cutoff - days * DAY && x < cutoff;
  }).length;
  // real sparkline series: completions in equal slices of the period
  const buckets = Math.min(12, days);
  const slice = (days * DAY) / buckets;
  const series = Array.from({ length: buckets }, (_, i) => {
    const b0 = cutoff + i * slice;
    return doneInPeriod.filter((t) => {
      const x = doneTs(t);
      return x >= b0 && x < b0 + slice;
    }).length;
  });
  // "em risco" counts the active projects (the KPI above them), as Insights does
  const riskN = activeProjects.filter((p) => projectRisk(db, p).level === "high").length;
  const myLate = myOpen.filter(isOverdue).length;

  const mine = [...myOpen]
    .sort((a, b) => cmp(a.dueDate || "9", b.dueDate || "9") || cmp(a.ref, b.ref))
    .slice(0, 6);
  const upcoming = tasks
    .filter((t) => t.status !== "done" && t.dueDate && (daysLeft(t.dueDate) ?? -999) >= -30)
    .sort((a, b) => cmp(a.dueDate ?? "", b.dueDate ?? "") || cmp(a.ref, b.ref))
    .slice(0, 6);
  const canSeeAudit = (a: AuditEntry) => {
    if (me.roleId === "admin") return true;
    const actor = db.users.find((u) => u.id === a.userId);
    return !!actor && actor.orgId === me.orgId;
  };
  const acts = db.audit
    .filter((a) => {
      if (a.projectId && !projects.some((p) => p.id === a.projectId)) return false;
      if (!a.projectId && (!canSeeAudit(a) || (!can("audit.view") && ADMIN_ENTITIES.includes(a.entityType))))
        return false;
      if (project && a.projectId !== project) return false;
      return new Date(a.ts).getTime() >= cutoff && a.action !== "denied";
    })
    .slice(0, 8);
  const favs = projects.filter((p) => isFavorite(p.id));

  return (
    <>
      <PageHead
        title={`${greeting(new Date().getHours())}, ${me.name.split(" ")[0]}`}
        sub={`Visão operacional de ${plural(projects.length, "projeto visível", "projetos visíveis")} para o seu perfil.`}
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
        <FilterSelect
          label="Período"
          value={period}
          def="30"
          onChange={setPeriod}
          options={["7", "14", "30", "90"].map((value) => ({ value, label: `Últimos ${value} dias` }))}
        />
        <FilterSelect
          label="Projeto"
          value={project}
          onChange={setProject}
          options={[{ value: "", label: "Todos" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
        />
        <FilterSelect
          label="Equipe"
          value={team}
          onChange={setTeam}
          options={[{ value: "", label: "Todas" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
        />
        <FilterSelect
          label="Responsável"
          value={assignee}
          onChange={setAssignee}
          options={[{ value: "", label: "Todos" }, ...people.map((u) => ({ value: u.id, label: u.name }))]}
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
      <div className="stat-strip">
        <Stat
          icon="folders"
          label="Projetos ativos"
          value={activeProjects.length}
          ctx={`${riskN} em risco`}
          tone={riskN ? "bad" : undefined}
          href="#/projects"
        />
        <Stat
          icon="user"
          label="Minhas tarefas abertas"
          value={myOpen.length}
          ctx={plural(myLate, "atrasada", "atrasadas")}
          tone={myLate ? "bad" : undefined}
          href="#/my-tasks"
        />
        <Stat
          icon="alert"
          label="Tarefas atrasadas"
          value={late.length}
          ctx="com os filtros atuais"
          tone={late.length ? "bad" : undefined}
        />
        <Stat icon="calendar" label="Vencem em 7 dias" value={next7.length} ctx="tarefas com prazo" />
        <Stat
          icon="check2"
          label="Concluídas no período"
          value={doneInPeriod.length}
          spark={series}
          delta={{ value: doneInPeriod.length - donePrev, label: ` vs. ${days} dias anteriores` }}
        />
      </div>
      <div className="grid c2-1">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h2>Minhas tarefas</h2>
              <span className="count">{myOpen.length}</span>
              <span className="spacer" />
              <a className="btn btn-ghost btn-sm" href="#/my-tasks">
                Ver todas
                <Icon name="arrowR" size={12} />
              </a>
            </div>
            <div className="panel-body flush list">
              {mine.length ? (
                mine.map((t) => <TaskRow key={t.id} task={t} />)
              ) : (
                <Empty title="Nada atribuído a você" sub="Tarefas atribuídas ao seu perfil aparecem aqui." />
              )}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Próximos prazos</h2>
              <span className="spacer" />
              {/* the list starts with overdue tasks: the chip says so, not only the next 7 days */}
              <span className="chip">
                {tasks.some(isOverdue)
                  ? `${plural(tasks.filter(isOverdue).length, "atrasada", "atrasadas")} · ${next7.length} em 7 dias`
                  : `${next7.length} em 7 dias`}
              </span>
            </div>
            <div className="panel-body flush list">
              {upcoming.length ? (
                upcoming.map((t) => <TaskRow key={t.id} task={t} />)
              ) : (
                <Empty
                  inline
                  icon="calendar"
                  title="Sem prazos com os filtros atuais"
                  sub="Defina prazos nas tarefas para acompanhá-las aqui."
                />
              )}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Atividades recentes</h2>
              <span className="spacer" />
              {can("audit.view") && (
                <a className="btn btn-ghost btn-sm" href="#/insights/audit">
                  Auditoria
                  <Icon name="arrowR" size={12} />
                </a>
              )}
            </div>
            <div className="panel-body">
              {acts.length ? (
                <ActivityFeed entries={acts} />
              ) : (
                <Empty
                  inline
                  icon="pulse"
                  title="Nenhuma atividade no período"
                  sub="Amplie o período ou limpe os filtros."
                />
              )}
            </div>
          </div>
        </div>
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h2>Sprints ativas</h2>
              <span className="spacer" />
              <a className="btn btn-ghost btn-sm" href="#/sprints">
                Sprints
                <Icon name="arrowR" size={12} />
              </a>
            </div>
            <div className="panel-body flush prog-list">
              {!activeSprints.length && (
                <Empty
                  inline
                  icon="sprint"
                  title="Nenhuma sprint ativa"
                  sub="Inicie uma sprint planejada para acompanhar o progresso aqui."
                >
                  <a className="btn btn-sm" href="#/sprints">
                    Ir para Sprints
                  </a>
                </Empty>
              )}
              {activeSprints.map((s) => {
                const p = db.projects.find((x) => x.id === s.projectId);
                const st = db.tasks.filter((t) => t.sprintId === s.id && !t.parentId);
                const done = st.filter((t) => t.status === "done").length;
                const pct = st.length ? Math.round((100 * done) / st.length) : 0;
                const left = daysLeft(s.endDate);
                const tone = left !== null && left < 0 ? " late" : left !== null && left <= 2 ? " soon" : "";
                return (
                  <div className="prog-block" key={s.id}>
                    <div className="pb-head">
                      <ProjectDot project={p} />
                      <b>{s.name}</b>
                      <span className="pb-sub">{p?.name}</span>
                      <span className="pb-num">
                        {done}/{st.length}
                      </span>
                    </div>
                    <Progress value={pct} label={`Progresso da ${s.name}`} />
                    <div className="pb-foot">
                      <span className="num">{pct}% concluído</span>
                      <span className="grow" />
                      <span className={`due${tone}`}>
                        <Icon name="clock" size={12} />
                        {left === null
                          ? "sem término"
                          : left < 0
                            ? `terminou ${fmtDate(s.endDate)}`
                            : left === 0
                              ? "termina hoje"
                              : `termina ${fmtDate(s.endDate)}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Projetos favoritos</h2>
            </div>
            <div className="panel-body flush list">
              {!favs.length && (
                <Empty
                  inline
                  icon="star"
                  title="Nenhum favorito"
                  sub="Marque projetos com a estrela na lista de Projetos para fixá-los aqui."
                >
                  <a className="btn btn-sm" href="#/projects">
                    Ver projetos
                  </a>
                </Empty>
              )}
              {favs.map((p) => (
                <a className="list-item" href={`#/projects/${p.id}`} key={p.id}>
                  <ProjectDot project={p} lg />
                  <span className="li-main">
                    <span className="li-title">{p.name}</span>
                    <span className="li-meta">
                      <span className="mono">{p.key}</span>
                      <span className="sepd" />
                      {projectProgress(db, p.id)}% concluído
                    </span>
                  </span>
                  <span className="li-trail">
                    <span className="chev" aria-hidden="true">
                      <Icon name="chevR" size={14} />
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Resumo por equipe</h2>
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
                  {teams.map((tm) => {
                    const open = tasks.filter((t) => t.teamId === tm.id && t.status !== "done");
                    if (!open.length && team && team !== tm.id) return null;
                    const lateN = open.filter(isOverdue).length;
                    return (
                      <tr key={tm.id}>
                        <td>{tm.name}</td>
                        <td className="num">{open.length}</td>
                        <td className="num">
                          <span className={lateN ? "text-danger" : "subtle"}>{lateN}</span>
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
