import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { TaskTable } from "../components/Tasks";
import {
  Avatar,
  announce,
  DueLabel,
  Empty,
  Field,
  FilterSelect,
  LabelChip,
  Menu,
  MenuButton,
  type MenuEntry,
  Overlay,
  PageHead,
  PrioGlyph,
  PriorityChip,
  Progress,
  ProjectDot,
  Select,
  StatusIcon,
  TaskRow,
  TypeIcon,
  useUI,
} from "../components/ui";
import type { Project, Sprint, Task, TaskStatus, User, WorkspaceData } from "../data/types";
import { useWorkspace, workspaceStore } from "../data/workspace";
import {
  daysLeft,
  fmtDate,
  isOverdue,
  LABELS,
  labelName,
  navigate,
  PRIO_META,
  PRIORITIES,
  plural,
  projectProgress,
  STATUS_META,
  STATUSES,
  todayLocal,
} from "../lib/format";

/* ============================ SELETOR DE PROJETO ============================ */
// mesmo controle e mesma posição (ao lado do título) em Kanban, Backlog e Sprints
export function useProjectPicker() {
  const { db, visibleProjects, act } = useWorkspace();
  const projects = visibleProjects.filter((p) => p.status !== "done"),
    project = projects.find((p) => p.id === db.settings.currentProjectId) ?? projects[0];
  return {
    project,
    picker: project ? (
      <div className="project-switch">
        <ProjectDot project={project} lg />
        <Select
          label="Projeto atual"
          value={project.id}
          onChange={act.setCurrentProject}
          options={projects.map((p) => ({ value: p.id, label: `${p.name} (${p.key})` }))}
        />
      </div>
    ) : (
      <span className="muted">Nenhum projeto disponível</span>
    ),
  };
}
/** People who can own tasks in the project: active members of its teams. */
function projectMembers(db: WorkspaceData, p: Project): User[] {
  return db.users.filter(
    (u) =>
      !u.invited &&
      u.orgId === p.orgId &&
      p.teamIds.some((tid) => db.teams.find((t) => t.id === tid)?.memberIds.includes(u.id)),
  );
}
const isBlocked = (db: WorkspaceData, t: Task) =>
  t.status !== "done" && t.blockedBy.some((id) => db.tasks.find((x) => x.id === id)?.status !== "done");

/* ============================ KANBAN ============================ */
type FilterKey = "assignee" | "priority" | "sprint" | "label";
type SortKey = "none" | "priority" | "due";
type BoardFilters = Record<FilterKey, string> & { q: string; group: SortKey };
const SORT_LABEL: Record<SortKey, string> = { none: "Criação", priority: "Prioridade", due: "Prazo" };
// filtros do quadro sobrevivem à navegação, como no protótipo
let boardMemory: BoardFilters = { q: "", assignee: "", priority: "", sprint: "", label: "", group: "none" };
const NO_FILTERS = { q: "", assignee: "", priority: "", sprint: "", label: "" };
interface FilterDef {
  key: FilterKey;
  name: string;
  ic: string;
  all: string;
  options: { value: string; label: string; node?: ReactNode }[];
}
// filtros do quadro: nome, opções (valor, rótulo, glifo) e rótulo do valor atual
function boardFilterDefs(db: WorkspaceData, p: Project): FilterDef[] {
  return [
    {
      key: "assignee",
      name: "Responsável",
      ic: "user",
      all: "Todos",
      options: projectMembers(db, p).map((u) => ({
        value: u.id,
        label: u.name,
        node: <Avatar user={u} size="sm" decorative />,
      })),
    },
    {
      key: "priority",
      name: "Prioridade",
      ic: "flag",
      all: "Todas",
      options: PRIORITIES.map((pr) => ({
        value: pr,
        label: PRIO_META[pr].label,
        node: (
          <span className="prio" style={{ color: PRIO_META[pr].color }} aria-hidden="true">
            <PrioGlyph priority={pr} />
          </span>
        ),
      })),
    },
    {
      key: "sprint",
      name: "Sprint",
      ic: "sprint",
      all: "Todas",
      options: db.sprints
        .filter((s) => s.projectId === p.id)
        .map((s) => ({
          value: s.id,
          label: `${s.name}${s.status === "active" ? " (ativa)" : s.status === "done" ? " (encerrada)" : ""}`,
        })),
    },
    {
      key: "label",
      name: "Etiqueta",
      ic: "tag",
      all: "Todas",
      options: LABELS.map((l) => ({ value: l, label: labelName(l) })),
    },
  ];
}

function KanbanCard({ t }: { t: Task }) {
  const { db, can, canTouchTask, act } = useWorkspace(),
    ui = useUI();
  const [drag, setDrag] = useState(false);
  const hintId = useId();
  const canDrag = canTouchTask(t) && can("task.move");
  const subs = db.tasks.filter((x) => x.parentId === t.id),
    subsDone = subs.filter((s) => s.status === "done").length;
  return (
    // biome-ignore lint/a11y/useSemanticElements: draggable card with block content (a <button> cannot hold it nor be dragged in every browser)
    <div
      className={`kcard${drag ? " dragging" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${t.ref} ${t.title}`}
      aria-describedby={hintId}
      aria-keyshortcuts={canDrag ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
      aria-current={ui.openTaskId === t.id ? "true" : undefined}
      data-fk={`kcard-${t.id}`}
      draggable={canDrag}
      onClick={() => ui.openTask(t.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ui.openTask(t.id);
          return;
        }
        // Alt+←/→ move para a coluna anterior/seguinte; Alt+↑/↓ não reordena (como no protótipo)
        if (canDrag && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          const to = STATUSES[STATUSES.indexOf(t.status) + (e.key === "ArrowRight" ? 1 : -1)];
          if (!to) return;
          act.moveTask(t.id, to);
          if (workspaceStore.getSnapshot().db.tasks.find((x) => x.id === t.id)?.status !== to) return;
          announce(`${t.ref} movida para ${STATUS_META[to].label}`);
          // o card muda de coluna (é montado de novo): o foco acompanha
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>(`[data-fk="kcard-${t.id}"]`)?.focus({ preventScroll: false }),
          );
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
        <TypeIcon type={t.type} size={14} />
        <span className="ref">{t.ref}</span>
        <span className="grow" />
        <Avatar user={db.users.find((u) => u.id === t.assigneeId)} size="sm" />
      </div>
      <div className="kc-title">{t.title}</div>
      {t.labels.length > 0 && (
        <div className="kc-labels">
          {t.labels.map((l) => (
            <LabelChip key={l} name={l} />
          ))}
        </div>
      )}
      <div className="kc-foot">
        <PriorityChip priority={t.priority} bare />
        {isBlocked(db, t) && (
          <span className="blocked-flag">
            <Icon name="block" size={12} />
            Bloqueada
          </span>
        )}
        <DueLabel task={t} lateForm />
        {subs.length > 0 && (
          <span className="due">
            <Icon name="subtask" size={12} />
            {subsDone}/{subs.length}
          </span>
        )}
      </div>
      <span id={hintId} className="sr-only">
        {STATUS_META[t.status].label}
        {canDrag ? ". Alt+seta esquerda ou direita move entre colunas" : ""}
        {subs.length ? `. Subtarefas concluídas: ${subsDone} de ${subs.length}` : ""}
      </span>
    </div>
  );
}

/** Quick add: stays open after Enter (audit E2E-33); Esc or leaving the field closes it. */
function QuickAdd({
  project,
  status,
  sprint,
  onClose,
}: {
  project: Project;
  status: TaskStatus;
  sprint: Sprint | undefined;
  onClose: () => void;
}) {
  const { act } = useWorkspace();
  const [title, setTitle] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="quick-add col-add">
      <input
        ref={input}
        className="input"
        placeholder="Título e Enter…"
        aria-label={`Nova tarefa em ${STATUS_META[status].label}`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.currentTarget.closest(".col")?.querySelector<HTMLElement>(".col-head .btn-icon")?.focus();
            onClose();
            return;
          }
          if (e.key === "Enter" && title.trim()) {
            e.preventDefault();
            // a sprint filtrada só vale se for deste projeto e não estiver encerrada
            const t = act.createTask({
              projectId: project.id,
              title: title.trim(),
              status,
              sprintId:
                sprint && sprint.projectId === project.id && sprint.status !== "done" ? sprint.id : null,
            });
            if (t) setTitle("");
          }
        }}
      />
    </div>
  );
}

export function Board() {
  const { db, can, canTouchTask, act } = useWorkspace(),
    ui = useUI(),
    { project: p, picker } = useProjectPicker();
  const [raw, setRaw] = useState<BoardFilters>(() => boardMemory),
    [menu, setMenu] = useState<"cat" | FilterKey | null>(null),
    [quick, setQuick] = useState<{ projectId: string; status: TaskStatus } | null>(null),
    [over, setOver] = useState<TaskStatus | null>(null);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  if (!p) return <Empty icon="board" title="Nenhum projeto" sub="Crie um projeto para usar o Kanban." />;
  const set = (patch: Partial<BoardFilters>) =>
    setRaw((cur) => {
      boardMemory = { ...cur, ...patch };
      return boardMemory;
    });
  const setFilter = (key: FilterKey, value: string) => {
    const patch: Partial<BoardFilters> = {};
    patch[key] = value;
    set(patch);
  };
  const focusFilter = () => requestAnimationFrame(() => filterBtn.current?.focus());
  const defs = boardFilterDefs(db, p);
  // sprint e responsável de outro projeto (ou fora do escopo) deixam de filtrar
  const f: BoardFilters = {
    ...raw,
    sprint: defs[2]?.options.some((o) => o.value === raw.sprint) ? raw.sprint : "",
    assignee: defs[0]?.options.some((o) => o.value === raw.assignee) ? raw.assignee : "",
  };
  const currentOption = (d: FilterDef) => d.options.find((o) => o.value === f[d.key]);
  const active = defs.filter((d) => f[d.key]);
  const q = f.q.trim().toLowerCase();
  const all = db.tasks.filter((t) => t.projectId === p.id && !t.parentId);
  const tasks = all.filter(
    (t) =>
      (!f.assignee || t.assigneeId === f.assignee) &&
      (!f.priority || t.priority === f.priority) &&
      (!f.sprint || t.sprintId === f.sprint) &&
      (!f.label || t.labels.includes(f.label)) &&
      (!q || t.title.toLowerCase().includes(q) || t.ref.toLowerCase().includes(q)),
  );
  if (f.group === "priority")
    tasks.sort(
      (a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.ref.localeCompare(b.ref),
    );
  if (f.group === "due")
    tasks.sort(
      (a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.ref.localeCompare(b.ref),
    );
  const filtering = !!(q || active.length);
  const canMoveHere = can("task.move");
  const sprint = db.sprints.find((s) => s.id === f.sprint);
  const menuItems = (): MenuEntry[] => {
    if (menu === "cat")
      return [
        "Filtrar por",
        ...defs.map((d) => ({
          icon: d.ic,
          label: d.name,
          sub: currentOption(d)?.label,
          onClick: () => setMenu(d.key),
        })),
      ];
    const d = defs.find((x) => x.key === menu);
    if (!d) return [];
    return [
      d.name,
      { label: d.all, radio: true, checked: !f[d.key], onClick: () => setFilter(d.key, "") },
      ...d.options.map((o) => ({
        label: o.label,
        node: o.node,
        radio: true,
        checked: f[d.key] === o.value,
        onClick: () => setFilter(d.key, o.value),
      })),
    ];
  };
  return (
    <>
      <PageHead title="Kanban" aside={picker}>
        {can("task.create") && (
          <button type="button" className="btn btn-primary" onClick={() => ui.task({ projectId: p.id })}>
            <Icon name="plus" size={14} />
            Nova tarefa
          </button>
        )}
      </PageHead>
      {/* barra de visão: busca · Filtro (menu) · chips removíveis · Ordenar */}
      <div className="fbar viewbar">
        <input
          className="input search"
          type="search"
          aria-label="Buscar no quadro"
          placeholder="Buscar por título ou ID…"
          value={raw.q}
          onChange={(e) => set({ q: e.target.value })}
        />
        <button
          ref={filterBtn}
          type="button"
          className="btn"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          aria-controls={menu ? menuId : undefined}
          aria-label={active.length ? `Filtro, ${plural(active.length, "ativo", "ativos")}` : "Filtro"}
          onClick={() => setMenu((m) => (m ? null : "cat"))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setMenu("cat");
            }
          }}
        >
          <Icon name="filter" size={14} />
          Filtro
          {active.length > 0 && (
            <span className="btn-count" aria-hidden="true">
              {active.length}
            </span>
          )}
        </button>
        {menu && filterBtn.current && (
          <Menu
            key={menu}
            id={menuId}
            anchor={filterBtn.current}
            label={menu === "cat" ? "Filtrar por" : (defs.find((d) => d.key === menu)?.name ?? "Filtro")}
            items={menuItems()}
            onClose={() => setMenu(null)}
          />
        )}
        {active.map((d) => {
          const val = currentOption(d)?.label ?? f[d.key];
          return (
            <button
              key={d.key}
              type="button"
              className="fchip"
              aria-label={`Remover filtro ${d.name}: ${val}`}
              onClick={() => {
                setFilter(d.key, "");
                focusFilter();
              }}
            >
              <span className="fk">{d.name}</span>
              <span>{val}</span>
              <span className="fx" aria-hidden="true">
                <Icon name="x" size={12} />
              </span>
            </button>
          );
        })}
        {(active.length > 1 || (active.length > 0 && !!q)) && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              set(NO_FILTERS);
              focusFilter();
            }}
          >
            Limpar tudo
          </button>
        )}
        <span className="grow" />
        <MenuButton
          className="btn"
          label={`Ordenar por ${SORT_LABEL[f.group]}`}
          menuLabel="Ordenar tarefas por"
          items={() => [
            "Ordenar tarefas por",
            ...(["none", "priority", "due"] as const).map((g) => ({
              label: SORT_LABEL[g],
              radio: true,
              checked: f.group === g,
              onClick: () => set({ group: g }),
            })),
          ]}
        >
          <Icon name="backlog" size={14} />
          <span className="subtle">Ordenar:</span>
          {SORT_LABEL[f.group]}
          <Icon name="chevD" size={12} />
        </MenuButton>
      </div>
      {filtering && !tasks.length ? (
        <Empty
          icon="filter"
          title="Nenhuma tarefa corresponde aos filtros"
          sub={`${plural(all.length, "tarefa oculta", "tarefas ocultas")} pelos filtros atuais.`}
        >
          <button
            type="button"
            className="btn"
            onClick={() => {
              set(NO_FILTERS);
              focusFilter();
            }}
          >
            <Icon name="x" size={12} />
            Limpar filtros
          </button>
        </Empty>
      ) : (
        <div className="board">
          {STATUSES.map((status) => {
            const ts = tasks.filter((t) => t.status === status),
              late = ts.filter(isOverdue).length,
              label = STATUS_META[status].label;
            return (
              <section
                key={status}
                aria-label={label}
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
                  <b>{label}</b>
                  <span className="count">{ts.length}</span>
                  {late > 0 && (
                    <span
                      className="chip danger"
                      role="img"
                      aria-label={plural(late, "tarefa atrasada", "tarefas atrasadas")}
                      data-tip={plural(late, "atrasada", "atrasadas")}
                    >
                      <Icon name="alert" size={12} />
                      {late}
                    </span>
                  )}
                  {can("task.create") && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      aria-label={`Criação rápida em ${label}`}
                      onClick={() => setQuick({ projectId: p.id, status })}
                    >
                      <Icon name="plus" size={13} />
                    </button>
                  )}
                </div>
                {quick?.projectId === p.id && quick.status === status && (
                  <QuickAdd project={p} status={status} sprint={sprint} onClose={() => setQuick(null)} />
                )}
                <div className="col-body">
                  {ts.map((t) => (
                    <KanbanCard key={t.id} t={t} />
                  ))}
                  {!ts.length && (
                    <div className="col-empty">
                      <span>Sem tarefas</span>
                      {canMoveHere && <span>Arraste uma tarefa para cá</span>}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ============================ BACKLOG ============================ */
export function Backlog() {
  const { can } = useWorkspace(),
    ui = useUI(),
    { project: p, picker } = useProjectPicker();
  return p ? (
    <>
      <PageHead title="Backlog" sub={`Tarefas de ${p.name} ainda fora de sprint.`} aside={picker}>
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

/* ============================ SPRINTS ============================ */
/** "Adicionar do backlog": menu of the project's open tasks outside a sprint (toast when empty). */
function AddFromBacklog({ sprint, project }: { sprint: Sprint; project: Project }) {
  const { db, act, notify } = useWorkspace();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const backlog = db.tasks
    .filter((t) => t.projectId === project.id && !t.sprintId && !t.parentId && t.status !== "done")
    .slice(0, 14);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="btn btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) return setOpen(false);
          if (!backlog.length) return notify("Backlog vazio", "Não há tarefas fora de sprint neste projeto.");
          setOpen(true);
        }}
      >
        <Icon name="plus" size={12} />
        Adicionar do backlog
      </button>
      {open && btn.current && (
        <Menu
          id={menuId}
          anchor={btn.current}
          label={`Associar à ${sprint.name}`}
          items={[
            `Associar à ${sprint.name}`,
            ...backlog.map((t) => ({
              label: `${t.ref} — ${t.title.slice(0, 44)}`,
              onClick: () => act.updateTask(t.id, { sprintId: sprint.id }),
            })),
          ]}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
const SPRINT_ORDER: Record<Sprint["status"], number> = { active: 0, planned: 1, done: 2 };
export function Sprints() {
  const { db, can, act } = useWorkspace(),
    ui = useUI(),
    { project: p, picker } = useProjectPicker();
  const [modal, setModal] = useState(false);
  if (!p) return <Empty icon="sprint" title="Nenhum projeto" sub="Crie um projeto para planejar sprints." />;
  const sprints = db.sprints
    .filter((s) => s.projectId === p.id)
    .sort(
      (a, b) =>
        SPRINT_ORDER[a.status] - SPRINT_ORDER[b.status] ||
        b.startDate.localeCompare(a.startDate) ||
        a.name.localeCompare(b.name),
    );
  const newBtn = can("sprint.manage") && (
    <button type="button" className="btn btn-primary" onClick={() => setModal(true)}>
      <Icon name="plus" size={14} />
      Nova sprint
    </button>
  );
  return (
    <>
      <PageHead title="Sprints" sub={`Planejamento e histórico de ${p.name}.`} aside={picker}>
        {newBtn}
      </PageHead>
      {!sprints.length ? (
        <Empty
          icon="sprint"
          title="Nenhuma sprint"
          sub="Crie a primeira sprint para organizar o trabalho em ciclos."
        >
          {newBtn}
        </Empty>
      ) : (
        <div className="stack">
          {sprints.map((s) => {
            const ts = db.tasks
                .filter((t) => t.sprintId === s.id && !t.parentId)
                .sort(
                  (a, b) =>
                    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.ref.localeCompare(b.ref),
                ),
              done = ts.filter((t) => t.status === "done").length,
              pct = ts.length ? Math.round((100 * done) / ts.length) : 0;
            return (
              <div className={`panel sprint-panel${s.status === "active" ? " is-active" : ""}`} key={s.id}>
                <div className="panel-head">
                  <h2>{s.name}</h2>
                  {s.status === "active" ? (
                    <span className="chip accent">
                      <Icon name="play" size={12} />
                      Ativa
                    </span>
                  ) : s.status === "planned" ? (
                    <span className="chip">
                      <Icon name="calendar" size={12} />
                      Planejada
                    </span>
                  ) : (
                    <span className="chip ok">
                      <Icon name="check" size={12} />
                      Concluída
                    </span>
                  )}
                  <span className="subtle num">
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
                            ui.confirm({
                              title: `Encerrar ${s.name}`,
                              message: "Tarefas não concluídas voltam para o backlog do projeto.",
                              label: "Encerrar sprint",
                              action: () => act.completeSprint(s.id),
                            })
                          }
                        >
                          Encerrar sprint
                        </button>
                      )}
                      {s.status !== "done" && <AddFromBacklog sprint={s} project={p} />}
                    </>
                  )}
                </div>
                <div className="panel-body sprint-sum">
                  <div className="sprint-goal">
                    <span className="ico">
                      <Icon name="flag" size={14} />
                    </span>
                    {s.goal ? (
                      <span>
                        <span className="subtle">Meta </span>
                        {s.goal}
                      </span>
                    ) : (
                      <span className="subtle">Sem meta definida</span>
                    )}
                  </div>
                  <div className="sprint-prog">
                    <Progress value={pct} label={`Progresso da ${s.name}`} />
                    <span className="num">
                      <b>
                        {done}/{ts.length}
                      </b>{" "}
                      concluídas · {pct}%
                    </span>
                  </div>
                </div>
                {ts.length ? (
                  <div className="list sprint-list">
                    {ts.slice(0, 8).map((t) => (
                      <TaskRow key={t.id} task={t} />
                    ))}
                    {ts.length > 8 && (
                      <button
                        type="button"
                        className="list-item compact more-row"
                        onClick={() => {
                          boardMemory = { ...boardMemory, ...NO_FILTERS, sprint: s.id };
                          act.setCurrentProject(p.id);
                          navigate("/board");
                        }}
                      >
                        <Icon name="board" size={14} />
                        <span className="li-main">
                          Ver mais {plural(ts.length - 8, "tarefa", "tarefas")} no Kanban
                        </span>
                        <span className="chev">
                          <Icon name="chevR" size={14} />
                        </span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="panel-body sprint-empty">
                    <Empty
                      inline
                      icon="tasks"
                      title="Nenhuma tarefa nesta sprint"
                      sub={
                        s.status === "done"
                          ? "A sprint terminou sem tarefas associadas."
                          : "Use “Adicionar do backlog” para planejar o ciclo."
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {modal && <SprintModal project={p} existing={sprints} onClose={() => setModal(false)} />}
    </>
  );
}

function SprintModal({
  project,
  existing,
  onClose,
}: {
  project: Project;
  existing: Sprint[];
  onClose: () => void;
}) {
  const { act } = useWorkspace();
  const numbers = existing.map((s) => Number.parseInt(s.name.match(/\d+/)?.[0] ?? "0", 10));
  const [name, setName] = useState(
      () => `Sprint ${numbers.length ? Math.max(...numbers) + 1 : existing.length + 1}`,
    ),
    [goal, setGoal] = useState(""),
    [start, setStart] = useState(() => todayLocal()),
    [end, setEnd] = useState(() => todayLocal(14)),
    [errors, setErrors] = useState<{ name?: string; end?: string }>({});
  const submit = () => {
    const next: { name?: string; end?: string } = {};
    const n = name.trim();
    if (!n) next.name = "Informe o nome";
    else if (existing.some((s) => s.name.trim().toLowerCase() === n.toLowerCase()))
      next.name = "Já existe uma sprint com esse nome neste projeto";
    if (!start || !end || end <= start) next.end = "Término deve ser depois do início";
    setErrors(next);
    if (next.name || next.end) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".modal-card [aria-invalid]")?.focus());
      return;
    }
    if (act.createSprint(project.id, { name: n, goal: goal.trim(), startDate: start, endDate: end }))
      onClose();
  };
  return (
    <Overlay
      title={`Nova sprint em ${project.name}`}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            Criar sprint
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Nome" wide required error={errors.name}>
          <input className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Meta" wide>
          <input
            className="input"
            maxLength={90}
            placeholder="Qual o objetivo desta sprint?"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </Field>
        <Field label="Início">
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Término" error={errors.end}>
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
    </Overlay>
  );
}

/* ============================ CRONOGRAMA ============================ */
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DAY = 86400000;
export function Timeline() {
  const { db, me, visibleProjects } = useWorkspace();
  const [span, setSpan] = useState("180"),
    [team, setTeam] = useState("");
  const now = Date.now(),
    days = Number(span),
    from = now - Math.round(days * 0.35) * DAY,
    to = now + Math.round(days * 0.65) * DAY,
    total = to - from;
  const pos = (date: string) =>
    Math.max(
      0,
      Math.min(
        100,
        (100 * (new Date(date + (date.length === 10 ? "T12:00:00" : "")).getTime() - from)) / total,
      ),
    );
  // cabeçalho de meses
  const months: { key: number; label: string; width: number }[] = [];
  const cursor = new Date(from);
  cursor.setDate(1);
  while (cursor.getTime() < to) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).getTime(),
      width = (100 * (Math.min(next, to) - Math.max(cursor.getTime(), from))) / total;
    if (width > 5)
      months.push({
        key: cursor.getTime(),
        label: `${MONTHS[cursor.getMonth()]}${cursor.getMonth() === 0 ? ` ${cursor.getFullYear()}` : ""}`,
        width,
      });
    cursor.setTime(next);
  }
  const teams = db.teams.filter((t) => me.roleId === "admin" || t.orgId === me.orgId);
  const projects = visibleProjects.filter(
    (p) => (!team || p.teamIds.includes(team)) && p.startDate && p.targetDate,
  );
  const today = pos(new Date(now).toISOString());
  return (
    <>
      <PageHead title="Cronograma" sub="Janelas dos projetos e marcos de entrega." />
      <div className="fbar">
        <FilterSelect
          label="Janela"
          value={span}
          onChange={setSpan}
          def="180"
          options={[
            { value: "90", label: "3 meses" },
            { value: "180", label: "6 meses" },
            { value: "365", label: "12 meses" },
          ]}
        />
        <FilterSelect
          label="Equipe"
          value={team}
          onChange={setTeam}
          options={[{ value: "", label: "Todas" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
        />
      </div>
      <div className="panel">
        <div className="gantt">
          <div className="g-grid">
            <div className="g-months">
              <div className="g-months-cell">Projeto</div>
              <div className="g-track-head">
                {months.map((m) => (
                  <div key={m.key} style={{ width: `${m.width}%` }}>
                    {m.label}
                  </div>
                ))}
              </div>
            </div>
            {projects.map((p) => {
              const target = p.targetDate ?? p.startDate,
                x1 = pos(p.startDate),
                x2 = pos(target),
                prog = projectProgress(db, p.id),
                late = p.status !== "done" && (daysLeft(p.targetDate) ?? 0) < 0;
              return (
                <div key={p.id} className="g-row">
                  <div className="g-label" title={p.name}>
                    <ProjectDot project={p} />
                    <span className="truncate">{p.name}</span>
                  </div>
                  <div className="g-track">
                    <a
                      className={`g-bar${p.status === "done" ? " done" : late ? " late" : ""}`}
                      href={`#/projects/${p.id}`}
                      style={{ left: `${x1}%`, width: `${Math.max(3, x2 - x1)}%` }}
                      data-tip={`${p.name} · ${prog}%`}
                      aria-label={`${p.name}, ${prog}% concluído, de ${fmtDate(p.startDate)} a ${fmtDate(target)}${
                        late ? ", prazo estourado" : p.status === "done" ? ", concluído" : ""
                      }`}
                    >
                      {p.key} · {prog}%
                    </a>
                    {db.milestones
                      .filter((m) => m.projectId === p.id)
                      .map((m) => (
                        <div
                          key={m.id}
                          className={`g-ms${m.status === "done" ? " done" : ""}`}
                          style={{ left: `calc(${pos(m.date)}% - 7px)` }}
                          data-tip={`${m.name} · ${fmtDate(m.date)}`}
                          role="img"
                          aria-label={`Marco: ${m.name}, ${fmtDate(m.date)}${m.status === "done" ? ", entregue" : ""}`}
                        />
                      ))}
                    {/* linha de hoje */}
                    <div className="g-today" style={{ left: `${today}%` }} />
                  </div>
                </div>
              );
            })}
            {!projects.length && (
              <Empty
                inline
                icon="calendar"
                title="Nenhum projeto no cronograma"
                sub="Projetos precisam de início e data de entrega para aparecer aqui."
              />
            )}
          </div>
        </div>
      </div>
      <div className="legend">
        <span>
          <i className="lg-bar accent" />
          Em andamento
        </span>
        <span>
          <i className="lg-bar ok" />
          Concluído
        </span>
        <span>
          <i className="lg-bar danger" />
          Prazo estourado
        </span>
        <span>
          <i className="lg-ms" />
          Marco
        </span>
        <span>
          <i className="lg-today" />
          Hoje
        </span>
      </div>
    </>
  );
}
