import { useState } from "react";
import { Icon } from "../components/Icon";
import { TaskRow, TaskTable } from "../components/Tasks";
import {
  Avatar,
  Empty,
  Field,
  LabelChip,
  MenuButton,
  Overlay,
  PageHead,
  PriorityChip,
  Progress,
  Select,
  StatusIcon,
  TypeIcon,
  useUI,
} from "../components/ui";
import type { Task, TaskStatus } from "../data/types";
import { useWorkspace } from "../data/workspace";
import {
  daysLeft,
  fmtDate,
  isOverdue,
  LABELS,
  navigate,
  PRIO_META,
  PRIORITIES,
  projectProgress,
  STATUS_META,
  STATUSES,
} from "../lib/format";
export function useProjectPicker() {
  const { db, visibleProjects, act } = useWorkspace();
  const projects = visibleProjects.filter((p) => p.status !== "done"),
    project = projects.find((p) => p.id === db.settings.currentProjectId) || projects[0];
  return {
    project,
    picker: (
      <Select
        label="Selecionar projeto"
        style={{ minWidth: 220, fontWeight: 600 }}
        value={project?.id || ""}
        onChange={act.setCurrentProject}
        options={projects.map((p) => ({ value: p.id, label: `${p.name} (${p.key})` }))}
      />
    ),
  };
}
function KanbanCard({ t }: { t: Task }) {
  const { db, can, canTouchTask } = useWorkspace(),
    ui = useUI();
  const [drag, setDrag] = useState(false);
  const subs = db.tasks.filter((x) => x.parentId === t.id),
    due = daysLeft(t.dueDate);
  return (
    <button
      type="button"
      className={`kcard${drag ? " dragging" : ""}`}
      tabIndex={0}
      aria-label={`${t.ref} ${t.title}`}
      draggable={canTouchTask(t) && can("task.move")}
      onClick={() => ui.openTask(t.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ui.openTask(t.id);
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/task-id", t.id);
        e.dataTransfer.effectAllowed = "move";
        setDrag(true);
      }}
      onDragEnd={() => setDrag(false)}
    >
      <div className="kc-top">
        <TypeIcon type={t.type} size={13} />
        <span className="ref">{t.ref}</span>
        <span className="grow" />
        <PriorityChip priority={t.priority} bare />
      </div>
      <div className="kc-title">{t.title}</div>
      {t.labels.length > 0 && (
        <div className="label-list" style={{ marginBottom: 7 }}>
          {t.labels.map((l) => (
            <LabelChip key={l} name={l} />
          ))}
        </div>
      )}
      <div className="kc-foot">
        {t.blockedBy.length > 0 && (
          <span className="blocked-flag">
            <Icon name="block" size={11} />
            bloqueada
          </span>
        )}
        {t.dueDate && (
          <span className={`due${isOverdue(t) ? " late" : ""}`}>
            <Icon name="timer" size={11} />
            {due !== null && due < 0 ? `${-due}d atrasada` : due === 0 ? "hoje" : fmtDate(t.dueDate)}
          </span>
        )}
        {subs.length > 0 && (
          <span className="due">
            <Icon name="subtask" size={11} />
            {subs.filter((s) => s.status === "done").length}/{subs.length}
          </span>
        )}
        <span className="sp" />
        <Avatar user={db.users.find((u) => u.id === t.assigneeId)} size="sm" />
      </div>
    </button>
  );
}
export function Board() {
  const { db, can, canTouchTask, act } = useWorkspace(),
    ui = useUI(),
    { project: p, picker } = useProjectPicker();
  const [q, setQ] = useState(""),
    [assignee, setAssignee] = useState(""),
    [priority, setPriority] = useState(""),
    [sprint, setSprint] = useState(""),
    [label, setLabel] = useState(""),
    [order, setOrder] = useState(""),
    [quick, setQuick] = useState<TaskStatus | null>(null),
    [title, setTitle] = useState(""),
    [over, setOver] = useState<TaskStatus | null>(null);
  if (!p) return <Empty icon="board" title="Nenhum projeto" sub="Crie um projeto para usar o Kanban." />;
  const tasks = db.tasks.filter(
    (t) =>
      t.projectId === p.id &&
      !t.parentId &&
      (!assignee || t.assigneeId === assignee) &&
      (!priority || t.priority === priority) &&
      (!sprint || t.sprintId === sprint) &&
      (!label || t.labels.includes(label)) &&
      `${t.title} ${t.ref}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  if (order === "priority")
    tasks.sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority));
  if (order === "due") tasks.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  return (
    <>
      <PageHead title="Kanban">
        {can("task.create") && (
          <button type="button" className="btn btn-primary" onClick={() => ui.task({ projectId: p.id })}>
            <Icon name="plus" size={14} />
            Nova tarefa
          </button>
        )}
      </PageHead>
      <div className="fbar">
        {picker}
        <input
          className="input search"
          aria-label="Buscar tarefas"
          type="search"
          placeholder="Buscar título ou ref…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Responsável"
          value={assignee}
          onChange={setAssignee}
          options={[
            { value: "", label: "Responsável: todos" },
            ...db.users.filter((u) => !u.invited).map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
        <Select
          label="Prioridade"
          value={priority}
          onChange={setPriority}
          options={[
            { value: "", label: "Prioridade: todas" },
            ...PRIORITIES.map((value) => ({ value, label: PRIO_META[value].label })),
          ]}
        />
        <Select
          label="Sprint"
          value={sprint}
          onChange={setSprint}
          options={[
            { value: "", label: "Sprint: todas" },
            ...db.sprints.filter((s) => s.projectId === p.id).map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <Select
          label="Etiqueta"
          value={label}
          onChange={setLabel}
          options={[
            { value: "", label: "Etiqueta: todas" },
            ...LABELS.map((value) => ({ value, label: value })),
          ]}
        />
        <Select
          label="Ordenação"
          value={order}
          onChange={setOrder}
          options={[
            { value: "", label: "Ordenar: padrão" },
            { value: "priority", label: "Ordenar: prioridade" },
            { value: "due", label: "Ordenar: vencimento" },
          ]}
        />
        {(q || assignee || priority || sprint || label) && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setQ("");
              setAssignee("");
              setPriority("");
              setSprint("");
              setLabel("");
            }}
          >
            <Icon name="x" size={12} />
            Limpar
          </button>
        )}
      </div>
      <div className="board">
        {STATUSES.map((status) => {
          const ts = tasks.filter((t) => t.status === status),
            late = ts.filter(isOverdue).length;
          return (
            <section
              key={status}
              aria-label={STATUS_META[status].label}
              className={`col${over === status ? " drop-over" : ""}`}
              data-status={status}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/task-id"),
                  task = db.tasks.find((t) => t.id === id);
                if (task && canTouchTask(task) && can("task.move") && task.status !== status)
                  act.moveTask(id, status);
              }}
            >
              <div className="col-head">
                <StatusIcon status={status} />
                <b>{STATUS_META[status].label}</b>
                <span className="cnt">{ts.length}</span>
                {late > 0 && (
                  <span className="chip danger" style={{ fontSize: 10.5 }}>
                    {late} atrasada{late > 1 ? "s" : ""}
                  </span>
                )}
                {can("task.create") && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    aria-label={`Criação rápida em ${STATUS_META[status].label}`}
                    onClick={() => {
                      setQuick(status);
                      setTitle("");
                    }}
                  >
                    <Icon name="plus" size={13} />
                  </button>
                )}
              </div>
              {quick === status && (
                <form
                  className="quick-add col-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (title.trim()) {
                      act.createTask({
                        projectId: p.id,
                        title: title.trim(),
                        status,
                        sprintId: sprint || null,
                      });
                      setTitle("");
                      setQuick(null);
                    }
                  }}
                >
                  <input
                    className="input"
                    placeholder="Título e Enter…"
                    aria-label="Nova tarefa"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setQuick(null);
                        e.stopPropagation();
                      }
                    }}
                  />
                </form>
              )}
              <div className="col-body">
                {ts.map((t) => (
                  <KanbanCard key={t.id} t={t} />
                ))}
                {!ts.length && (
                  <div
                    className="subtle"
                    style={{
                      textAlign: "center",
                      padding: 14,
                      fontSize: 11.5,
                      border: "1px dashed var(--border)",
                      borderRadius: 6,
                    }}
                  >
                    Arraste cards para cá
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
export function Backlog() {
  const { can } = useWorkspace(),
    ui = useUI(),
    { project: p, picker } = useProjectPicker();
  return p ? (
    <>
      <PageHead title="Backlog" sub={`Tarefas de ${p.name} ainda fora de sprint.`}>
        {picker}
        {can("task.create") && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => ui.task({ projectId: p.id, status: "backlog" })}
          >
            <Icon name="plus" size={14} />
            Nova tarefa
          </button>
        )}
      </PageHead>
      <TaskTable projectId={p.id} backlogMode />
    </>
  ) : (
    <Empty icon="backlog" title="Nenhum projeto" sub="Crie um projeto para planejar o backlog." />
  );
}
export function Sprints() {
  const { db, can, act } = useWorkspace(),
    ui = useUI(),
    { project: p, picker } = useProjectPicker();
  const [modal, setModal] = useState(false),
    [name, setName] = useState(""),
    [goal, setGoal] = useState(""),
    [start, setStart] = useState(new Date().toISOString().slice(0, 10)),
    [end, setEnd] = useState(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)),
    [error, setError] = useState("");
  if (!p) return <Empty icon="sprint" title="Nenhum projeto" sub="Crie um projeto para planejar sprints." />;
  const order = { active: 0, planned: 1, done: 2 };
  const sprints = db.sprints
    .filter((s) => s.projectId === p.id)
    .sort((a, b) => order[a.status] - order[b.status] || b.startDate.localeCompare(a.startDate));
  const open = () => {
    setName(`Sprint ${Math.max(0, ...sprints.map((s) => Number(s.name.match(/\d+/)?.[0] || 0))) + 1}`);
    setError("");
    setModal(true);
  };
  return (
    <>
      <PageHead title="Sprints" sub={`Planejamento e histórico de ${p.name}.`}>
        {picker}
        {can("sprint.manage") && (
          <button type="button" className="btn btn-primary" onClick={open}>
            <Icon name="plus" size={14} />
            Nova sprint
          </button>
        )}
      </PageHead>
      {!sprints.length && (
        <Empty
          icon="sprint"
          title="Nenhuma sprint"
          sub="Crie a primeira sprint para organizar o trabalho em ciclos."
        />
      )}
      {sprints.map((s) => {
        const ts = db.tasks
            .filter((t) => t.sprintId === s.id && !t.parentId)
            .sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)),
          done = ts.filter((t) => t.status === "done").length,
          pct = ts.length ? Math.round((100 * done) / ts.length) : 0,
          backlog = db.tasks.filter(
            (t) => t.projectId === p.id && !t.sprintId && !t.parentId && t.status !== "done",
          );
        return (
          <div className="panel" key={s.id} style={{ marginBottom: 14 }}>
            <div className="panel-head">
              <h2>{s.name}</h2>
              <span className={`chip ${s.status === "active" ? "accent" : s.status === "done" ? "ok" : ""}`}>
                {s.status === "active" ? "ativa" : s.status === "done" ? "concluída" : "planejada"}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {fmtDate(s.startDate)} → {fmtDate(s.endDate)}
              </span>
              <span className="spacer" />
              {can("sprint.manage") && (
                <>
                  {s.status === "planned" && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => act.startSprint(s.id)}
                    >
                      <Icon name="play" size={12} />
                      Iniciar sprint
                    </button>
                  )}
                  {s.status === "active" && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        ui.confirm(
                          `Encerrar ${s.name}`,
                          "Tarefas não concluídas voltam para o backlog do projeto.",
                          () => act.completeSprint(s.id),
                          "Encerrar sprint",
                        )
                      }
                    >
                      Encerrar sprint
                    </button>
                  )}
                  {s.status !== "done" && (
                    <MenuButton
                      className="btn btn-sm"
                      label="Adicionar do backlog"
                      items={
                        backlog.length
                          ? [
                              `Associar à ${s.name}`,
                              ...backlog.slice(0, 14).map((t) => ({
                                label: `${t.ref} — ${t.title.slice(0, 44)}`,
                                onClick: () => act.updateTask(t.id, { sprintId: s.id }),
                              })),
                            ]
                          : ["Backlog vazio"]
                      }
                    >
                      <Icon name="plus" size={12} />
                      Adicionar do backlog
                    </MenuButton>
                  )}
                </>
              )}
            </div>
            <div className="panel-body">
              {s.goal && (
                <p className="muted" style={{ fontSize: 12.5 }}>
                  <Icon name="flag" size={12} /> Meta: {s.goal}
                </p>
              )}
              <div className="inline-row" style={{ gap: 10, margin: "8px 0" }}>
                <Progress value={pct} />
                <span className="num muted" style={{ fontSize: 12 }}>
                  {done}/{ts.length} concluídas ({pct}%)
                </span>
              </div>
              {ts.length ? (
                <>
                  {ts.slice(0, 8).map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                  {ts.length > 8 && (
                    <p className="subtle" style={{ fontSize: 11.5, padding: "6px 14px" }}>
                      + {ts.length - 8} tarefas — veja no Kanban filtrando por esta sprint.
                    </p>
                  )}
                </>
              ) : (
                <p className="subtle" style={{ fontSize: 12 }}>
                  Nenhuma tarefa associada ainda.
                </p>
              )}
            </div>
          </div>
        );
      })}
      {modal && (
        <Overlay
          title={`Nova sprint em ${p.name}`}
          onClose={() => setModal(false)}
          foot={
            <>
              <button type="button" className="btn" onClick={() => setModal(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!name.trim()) {
                    setError("Informe o nome");
                    return;
                  }
                  if (!start || !end || end <= start) {
                    setError("Término deve ser depois do início");
                    return;
                  }
                  if (
                    act.createSprint(p.id, {
                      name: name.trim(),
                      goal: goal.trim(),
                      startDate: start,
                      endDate: end,
                    })
                  )
                    setModal(false);
                }}
              >
                Criar sprint
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="Nome" wide>
              <input
                className="input"
                aria-label="Nome"
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Meta" wide>
              <input
                className="input"
                aria-label="Meta"
                placeholder="Qual o objetivo desta sprint?"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </Field>
            <Field label="Início">
              <input
                className="input"
                aria-label="Início"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="Término" error={error}>
              <input
                className="input"
                aria-label="Término"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
        </Overlay>
      )}
    </>
  );
}
export function Timeline() {
  const { db, visibleProjects } = useWorkspace();
  const [span, setSpan] = useState("180"),
    [team, setTeam] = useState("");
  const from = Date.now() - Math.round(Number(span) * 0.35) * 86400000,
    to = Date.now() + Math.round(Number(span) * 0.65) * 86400000,
    total = to - from;
  const pos = (date: string) =>
    Math.max(
      0,
      Math.min(
        100,
        (100 * (new Date(date + (date.length === 10 ? "T12:00:00" : "")).getTime() - from)) / total,
      ),
    );
  const months: { label: string; width: number }[] = [];
  const cursor = new Date(from);
  cursor.setDate(1);
  while (cursor.getTime() < to) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).getTime(),
      width = (100 * (Math.min(next, to) - Math.max(cursor.getTime(), from))) / total;
    if (width > 5)
      months.push({
        label:
          ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][
            cursor.getMonth()
          ] + (cursor.getMonth() === 0 ? ` ${cursor.getFullYear()}` : ""),
        width,
      });
    cursor.setTime(next);
  }
  const projects = visibleProjects.filter(
    (p) => (!team || p.teamIds.includes(team)) && p.startDate && p.targetDate,
  );
  return (
    <>
      <PageHead title="Cronograma" sub="Janelas dos projetos e marcos de entrega." />
      <div className="fbar">
        <Select
          label="Janela"
          value={span}
          onChange={setSpan}
          options={[
            { value: "90", label: "Janela de 3 meses" },
            { value: "180", label: "Janela de 6 meses" },
            { value: "365", label: "Janela de 12 meses" },
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
      </div>
      <div className="panel">
        <div className="gantt">
          <div className="g-grid">
            <div className="g-months">
              <div style={{ width: 220, flex: "none", borderLeft: 0 }}>Projeto</div>
              <div style={{ display: "flex", flex: 1 }}>
                {months.map((m) => (
                  <div key={m.label} style={{ width: `${m.width}%` }}>
                    {m.label}
                  </div>
                ))}
              </div>
            </div>
            {projects.map((p) => {
              const x1 = pos(p.startDate),
                x2 = pos(p.targetDate || p.startDate),
                prog = projectProgress(db, p.id),
                late = p.status !== "done" && (daysLeft(p.targetDate) ?? 0) < 0;
              return (
                <div key={p.id} className="g-row">
                  <div className="g-label">{p.name}</div>
                  <div className="g-track">
                    <button
                      type="button"
                      className={`g-bar ${p.status === "done" ? "done" : late ? "late" : ""}`}
                      style={{ left: `${x1}%`, width: `${Math.max(3, x2 - x1)}%` }}
                      data-tip={`${p.name} · ${prog}%`}
                      onClick={() => navigate(`/projects/${p.id}`)}
                    >
                      {p.key} · {prog}%
                    </button>
                    {db.milestones
                      .filter((m) => m.projectId === p.id)
                      .map((m) => (
                        <div
                          key={m.id}
                          className={`g-ms${m.status === "done" ? " done" : ""}`}
                          style={{ left: `calc(${pos(m.date)}% - 7px)` }}
                          data-tip={`${m.name} · ${fmtDate(m.date)}`}
                          role="img"
                          aria-label={`Marco: ${m.name}`}
                        />
                      ))}
                    <div className="g-today" style={{ left: `${pos(new Date().toISOString())}%` }} />
                  </div>
                </div>
              );
            })}
            {!projects.length && <div className="empty">Nenhum projeto com datas na janela atual.</div>}
          </div>
        </div>
      </div>
      <div className="legend">
        <span>
          <i style={{ background: "var(--accent)" }} />
          Projeto em andamento
        </span>
        <span>
          <i style={{ background: "var(--ok)" }} />
          Concluído
        </span>
        <span>
          <i style={{ background: "var(--danger)" }} />
          Atrasado
        </span>
        <span>◇ Marco de entrega</span>
      </div>
    </>
  );
}
