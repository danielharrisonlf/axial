import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { Sprint, Task, TaskStatus, WorkspaceData } from "../data/types";
import { useWorkspace, workspaceStore } from "../data/workspace";
import {
  daysLeft,
  fmtDate,
  fmtDateTime,
  isOverdue,
  LABELS,
  labelName,
  PRIO_META,
  PRIORITIES,
  plural,
  rel,
  STATUS_META,
  STATUSES,
  sourceLabel,
} from "../lib/format";
import { Icon } from "./Icon";
import {
  Avatar,
  announce,
  Empty,
  FilterSelect,
  LabelChip,
  MenuButton,
  type MenuEntry,
  Overlay,
  PrioGlyph,
  PriorityChip,
  Progress,
  ProjectDot,
  PropButton,
  type PropOption,
  PropValue,
  StatusChip,
  StatusIcon,
  TypeIcon,
  TaskRow as UITaskRow,
  useUI,
  Who,
} from "./ui";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

/** Compatibility for pages still importing from here: the ListRow lives in ui.tsx (it always shows the due date). */
export function TaskRow({ task, showProject }: { task: Task; showProject?: boolean; withDue?: boolean }) {
  return <UITaskRow task={task} showProject={showProject} />;
}

/** Open blockers of a task (done tasks no longer block). */
const activeBlockers = (db: WorkspaceData, t: Task): Task[] =>
  t.blockedBy
    .map((id) => db.tasks.find((x) => x.id === id))
    .filter((x): x is Task => !!x && x.status !== "done");
const isBlocked = (db: WorkspaceData, t: Task) => t.status !== "done" && activeBlockers(db, t).length > 0;
/** Adding `blockerId` as a blocker of `taskId` closes a cycle when the blocker already depends on the task. */
function wouldCycle(db: WorkspaceData, taskId: string, blockerId: string): boolean {
  const seen = new Set<string>();
  const reaches = (id: string): boolean => {
    if (id === taskId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (db.tasks.find((x) => x.id === id)?.blockedBy ?? []).some(reaches);
  };
  return reaches(blockerId);
}
/** Enter (outside IME composition) on a single-line add field. */
const isEnter = (e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && !e.nativeEvent.isComposing;

/* ==========================================================================
   Tabela de tarefas
   ========================================================================== */
type SortKey = "ref" | "title" | "status" | "priority" | "due" | "updated";
const SORTERS: Record<SortKey, (t: Task) => string | number> = {
  ref: (t) => t.ref,
  title: (t) => t.title.toLowerCase(),
  status: (t) => STATUSES.indexOf(t.status),
  priority: (t) => PRIORITIES.indexOf(t.priority),
  due: (t) => t.dueDate || "9999",
  updated: (t) => t.updatedAt,
};
const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);
const PAGE = 15;

export function TaskTable({
  projectId,
  assigneeId,
  backlogMode = false,
}: {
  projectId?: string;
  assigneeId?: string;
  backlogMode?: boolean;
}) {
  const { db, visibleTasks, can } = useWorkspace();
  const ui = useUI();
  const search = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [prio, setPrio] = useState("");
  const [assignee, setAssignee] = useState("");
  const [sort, setSort] = useState<SortKey>(backlogMode ? "priority" : "due");
  const [dir, setDir] = useState(1);
  const [page, setPage] = useState(0);
  const change = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(0);
  };
  const filtered = !!(q || status || prio || assignee);
  const clear = () => {
    setQ("");
    setStatus("");
    setPrio("");
    setAssignee("");
    setPage(0);
    search.current?.focus();
  };
  const term = q.trim().toLowerCase();
  const tasks = visibleTasks.filter(
    (t) =>
      !t.parentId &&
      (!projectId || t.projectId === projectId) &&
      (!assigneeId || t.assigneeId === assigneeId) &&
      (!backlogMode || (!t.sprintId && t.status !== "done")) &&
      (!status || t.status === status) &&
      (!prio || t.priority === prio) &&
      (!assignee || t.assigneeId === assignee) &&
      (!term || t.title.toLowerCase().includes(term) || t.ref.toLowerCase().includes(term)),
  );
  tasks.sort((a, b) => cmp(SORTERS[sort](a), SORTERS[sort](b)) * dir || cmp(a.ref, b.ref));
  const pages = Math.max(1, Math.ceil(tasks.length / PAGE));
  const current = Math.min(page, pages - 1);
  const th = (key: SortKey, label: string) => (
    <th className="sortable" aria-sort={sort === key ? (dir > 0 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="th-sort"
        onClick={() => {
          const next = sort === key ? -dir : 1;
          setSort(key);
          setDir(next);
          announce(`Ordenado por ${label}${next > 0 ? ", crescente" : ", decrescente"}`);
        }}
      >
        {label}
      </button>
    </th>
  );
  const count = <span className="num">{plural(tasks.length, "tarefa", "tarefas")}</span>;
  return (
    <>
      <div className="fbar">
        <input
          ref={search}
          className="input search"
          type="search"
          aria-label="Buscar tarefas"
          placeholder="Buscar por título ou ID…"
          value={q}
          onChange={(e) => change(setQ)(e.target.value)}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={change(setStatus)}
          options={[
            { value: "", label: "Todos" },
            ...STATUSES.map((value) => ({ value, label: STATUS_META[value].label })),
          ]}
        />
        <FilterSelect
          label="Prioridade"
          value={prio}
          onChange={change(setPrio)}
          options={[
            { value: "", label: "Todas" },
            ...PRIORITIES.map((value) => ({ value, label: PRIO_META[value].label })),
          ]}
        />
        {!assigneeId && (
          <FilterSelect
            label="Responsável"
            value={assignee}
            onChange={change(setAssignee)}
            options={[
              { value: "", label: "Todos" },
              ...db.users.filter((u) => !u.invited).map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        )}
        {filtered && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
            <Icon name="x" size={12} />
            Limpar
          </button>
        )}
      </div>
      {!tasks.length ? (
        filtered ? (
          <Empty
            icon="filter"
            title="Nenhuma tarefa corresponde aos filtros"
            sub="Ajuste a busca ou limpe os filtros para ver todas as tarefas."
          >
            <button type="button" className="btn" onClick={clear}>
              <Icon name="x" size={12} />
              Limpar filtros
            </button>
          </Empty>
        ) : (
          <Empty
            title="Nenhuma tarefa por aqui"
            sub={
              can("task.create")
                ? "Crie uma tarefa para começar."
                : "Quando houver tarefas para você, elas aparecem aqui."
            }
          >
            {can("task.create") && (
              <button type="button" className="btn btn-primary" onClick={() => ui.task({ projectId })}>
                <Icon name="plus" size={14} />
                Nova tarefa
              </button>
            )}
          </Empty>
        )
      ) : (
        <div className="panel">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="col-icon">
                    <span className="sr-only">Tipo</span>
                  </th>
                  {th("ref", "ID")}
                  {th("title", "Título")}
                  {th("status", "Status")}
                  {th("priority", "Prioridade")}
                  <th>Responsável</th>
                  <th>{projectId ? "Sprint" : "Projeto"}</th>
                  {th("due", "Prazo")}
                  {th("updated", "Atualizada")}
                </tr>
              </thead>
              <tbody>
                {tasks.slice(current * PAGE, current * PAGE + PAGE).map((t) => {
                  const selected = ui.openTaskId === t.id;
                  const proj = db.projects.find((p) => p.id === t.projectId);
                  const sprint = db.sprints.find((s) => s.id === t.sprintId);
                  return (
                    <tr key={t.id} className={selected ? "is-selected" : undefined}>
                      <td>
                        <TypeIcon type={t.type} />
                      </td>
                      <td className="mono nowrap subtle">{t.ref}</td>
                      <td>
                        <div className="cell-title">
                          <div className="tt">
                            <button
                              type="button"
                              className="row-link"
                              aria-current={selected || undefined}
                              onClick={() => ui.openTask(t.id)}
                            >
                              {t.title}
                            </button>
                            {isBlocked(db, t) && (
                              <span className="chip warn">
                                <Icon name="block" size={12} />
                                Bloqueada
                              </span>
                            )}
                          </div>
                          {t.labels.length > 0 && (
                            <div className="cell-chips">
                              {t.labels.map((l) => (
                                <LabelChip key={l} name={l} />
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <StatusChip status={t.status} />
                      </td>
                      <td>
                        <PriorityChip priority={t.priority} />
                      </td>
                      <td>
                        <Who id={t.assigneeId} />
                      </td>
                      <td>
                        {projectId ? (
                          sprint ? (
                            sprint.name
                          ) : (
                            <span className="subtle">—</span>
                          )
                        ) : (
                          <span className="cell-main">
                            <ProjectDot project={proj} />
                            {proj?.name}
                          </span>
                        )}
                      </td>
                      <td className="date">
                        {t.dueDate ? (
                          <span className={isOverdue(t) ? "text-danger" : undefined}>
                            {fmtDate(t.dueDate)}
                          </span>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>
                      <td className="date subtle">{rel(t.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pager">
            {count}
            {pages > 1 && (
              <>
                <span className="grow" />
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={current === 0}
                  onClick={() => setPage(current - 1)}
                >
                  <Icon name="chevL" size={12} />
                  Anterior
                </button>
                <span className="num">
                  {current + 1} / {pages}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={current === pages - 1}
                  onClick={() => setPage(current + 1)}
                >
                  Próxima
                  <Icon name="chevR" size={12} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ==========================================================================
   Inspector de tarefa (drawer)
   ========================================================================== */
const SPRINT_ST: Record<Sprint["status"], string> = {
  active: "ativa",
  planned: "planejada",
  done: "encerrada",
};
/** Timeline node tone and icon per audit origin (the .src-tag says the origin in text). */
const SRC_NODE: Record<string, string> = {
  ui: "accent",
  ai: "violet",
  mcp: "violet",
  automation: "info",
  api: "warn",
};
const srcIcon = (source: string) =>
  source === "ai" || source === "mcp"
    ? "sparkle"
    : source === "automation"
      ? "refresh"
      : source === "api"
        ? "plug"
        : "user";
/** Decorative priority glyph (the label next to it carries the value). */
const prioGlyph = (p: Task["priority"]) => (
  <span className="prio" style={{ color: PRIO_META[p].color }} aria-hidden="true">
    <PrioGlyph priority={p} />
  </span>
);

/** Property row of the inspector: icon + label, then the control. */
function Prop({ label, icon, children }: { label: string; icon: string; children: ReactNode }) {
  return (
    <>
      <span className="pl">
        <span className="ico">
          <Icon name={icon} size={14} />
        </span>
        {label}
      </span>
      {children}
    </>
  );
}

export function TaskDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { db, me, can, canTouchTask, act, notify } = useWorkspace();
  const ui = useUI();
  const t = db.tasks.find((x) => x.id === id);
  const p = t ? db.projects.find((x) => x.id === t.projectId) : undefined;
  const [title, setTitle] = useState(t?.title ?? "");
  const [desc, setDesc] = useState(t?.desc ?? "");
  const [criterion, setCriterion] = useState("");
  const [sub, setSub] = useState("");
  const [comment, setComment] = useState("");
  // keeps the drafts in sync when the task changes elsewhere (another tab, the board, the store)
  useEffect(() => setTitle(t?.title ?? ""), [t?.title]);
  useEffect(() => setDesc(t?.desc ?? ""), [t?.desc]);
  // API mode: comments and history are read when the drawer opens (the demo keeps them in memory)
  useEffect(() => workspaceStore.act.loadTask?.(id), [id]);
  // Esc (or any other close) unmounts the drawer before blur fires: commit what was typed
  const draft = useRef({ title, desc });
  draft.current = { title, desc };
  useEffect(
    () => () => {
      const current = workspaceStore.getSnapshot().db.tasks.find((x) => x.id === id);
      if (!current || !workspaceStore.canTouchTask(current)) return;
      const nextTitle = draft.current.title.trim();
      const nextDesc = draft.current.desc.trim();
      const fields: Partial<Task> = {};
      if (nextTitle && nextTitle !== current.title) fields.title = nextTitle;
      if (nextDesc !== current.desc) fields.desc = nextDesc;
      if (Object.keys(fields).length) workspaceStore.act.updateTask(id, fields);
    },
    [id],
  );
  if (!t || !p) return null;

  const edit = canTouchTask(t);
  const copyRef = () => {
    const fail = () =>
      notify("Não foi possível copiar", "O navegador bloqueou a área de transferência.", "warn");
    if (!navigator.clipboard?.writeText) {
      fail();
      return;
    }
    navigator.clipboard.writeText(t.ref).then(() => notify(`Referência ${t.ref} copiada`, "", "ok"), fail);
  };
  const menuItems = (): MenuEntry[] => {
    const items: MenuEntry[] = [];
    if (edit && can("task.move")) {
      for (const s of STATUSES)
        if (s !== t.status)
          items.push({ label: `Mover para ${STATUS_META[s].label}`, onClick: () => act.moveTask(id, s) });
      items.push("sep");
    }
    items.push({ icon: "copy", label: `Copiar referência (${t.ref})`, onClick: copyRef });
    if (can("task.delete") && edit)
      items.push({
        icon: "trash",
        label: "Excluir tarefa…",
        danger: true,
        onClick: () =>
          ui.confirm({
            title: "Excluir tarefa",
            message: `Remove ${t.ref} e suas subtarefas. Não pode ser desfeito.`,
            label: "Excluir",
            danger: true,
            action: () => {
              onClose();
              act.deleteTask(id);
            },
          }),
      });
    return items;
  };

  // properties
  const statusNode = (s: TaskStatus) => <StatusIcon status={s} />;
  const members = db.users.filter(
    (u) =>
      !u.invited &&
      p.teamIds.some((tid) => db.teams.find((tm) => tm.id === tid)?.memberIds.includes(u.id)) &&
      (can("task.assign") || u.id === me.id),
  );
  const who = db.users.find((u) => u.id === t.assigneeId);
  // the current assignee always shows up (even after leaving the team)
  if (who && !members.some((u) => u.id === who.id)) members.push(who);
  const canAssign = edit && (can("task.assign") || !t.assigneeId || t.assigneeId === me.id);
  const epic = db.epics.find((e) => e.id === t.epicId);
  const sprint = db.sprints.find((s) => s.id === t.sprintId);
  const dl = daysLeft(t.dueDate);
  const blockers = t.status !== "done" ? activeBlockers(db, t) : [];
  const blockedBy = t.blockedBy
    .map((bid) => db.tasks.find((x) => x.id === bid))
    .filter((x): x is Task => !!x);
  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const openLink = (target: Task, className?: string, children: ReactNode = target.ref) => (
    // biome-ignore lint/a11y/useValidAnchor: opens the related task in this inspector (prototype markup and styles)
    <a
      key={target.id}
      href="#"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        ui.openTask(target.id);
      }}
    >
      {children}
    </a>
  );

  const subs = db.tasks.filter((x) => x.parentId === t.id);
  const subDone = subs.filter((x) => x.status === "done").length;
  const canAddSub = edit && can("task.create", t.projectId) && !t.parentId;
  const accDone = t.acceptance.filter((a) => a.done).length;
  const comments = db.comments.filter((c) => c.taskId === t.id).sort((a, b) => cmp(a.createdAt, b.createdAt));
  const hist = db.audit.filter((a) => a.entityType === "task" && a.entityId === t.id).slice(0, 12);

  const commitTitle = () => {
    const v = title.trim();
    if (!v) {
      setTitle(t.title);
      notify("Título obrigatório", "O título não pode ficar vazio; o valor anterior foi mantido.", "warn");
      return;
    }
    if (v !== t.title) act.updateTask(id, { title: v });
  };
  const sendComment = () => {
    if (!comment.trim()) return;
    act.addComment(id, comment.trim());
    setComment("");
  };

  return (
    <Overlay
      drawer
      label={`Tarefa ${t.ref}`}
      head={
        <div className="drawer-crumb">
          <TypeIcon type={t.type} size={16} />
          <span className="ref">{t.ref}</span>
          <span className="sep" aria-hidden="true">
            <Icon name="chevR" size={12} />
          </span>
          <a href={`#/projects/${p.id}`} onClick={onClose}>
            <ProjectDot project={p} />
            {p.name}
          </a>
        </div>
      }
      onClose={onClose}
      headActions={
        <>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={`Copiar referência ${t.ref}`}
            onClick={copyRef}
          >
            <Icon name="copy" size={15} />
          </button>
          <MenuButton label="Ações da tarefa" className="btn btn-ghost btn-icon" items={menuItems}>
            <Icon name="dots" size={15} />
          </MenuButton>
        </>
      }
    >
      <textarea
        className="textarea task-title"
        rows={1}
        aria-label="Título da tarefa"
        disabled={!edit}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
      />
      {!edit && (
        <p className="ro-note">
          <Icon name="block" size={12} />
          Somente leitura para o perfil atual.
        </p>
      )}
      {blockers.length > 0 && (
        <div className="banner warn" role="status">
          <Icon name="block" size={14} />
          <span>
            Bloqueada por{" "}
            {blockers.map((bt, i) => (
              <span key={bt.id}>
                {i > 0 && ", "}
                {openLink(bt)}
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="task-props">
        <Prop label="Status" icon="check2">
          <PropButton
            label="Status"
            value={t.status}
            disabled={!edit || !can("task.move")}
            options={STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label, node: statusNode(s) }))}
            onChange={(v) => act.moveTask(id, v as TaskStatus)}
          />
        </Prop>
        <Prop label="Prioridade" icon="flag">
          <PropButton
            label="Prioridade"
            value={t.priority}
            disabled={!edit}
            options={PRIORITIES.map((pr) => ({ value: pr, label: PRIO_META[pr].label, node: prioGlyph(pr) }))}
            onChange={(v) => act.updateTask(id, { priority: v as Task["priority"] })}
          />
        </Prop>
        <Prop label="Responsável" icon="user">
          {canAssign ? (
            <PropButton
              label="Responsável"
              value={t.assigneeId ?? ""}
              empty="Sem responsável"
              options={[
                { value: "", label: "Sem responsável", node: <Avatar user={null} size="sm" decorative /> },
                ...members.map(
                  (u): PropOption => ({
                    value: u.id,
                    label: u.name,
                    node: <Avatar user={u} size="sm" decorative />,
                  }),
                ),
              ]}
              onChange={(v) => act.updateTask(id, { assigneeId: v || null })}
            />
          ) : (
            <PropValue
              node={<Avatar user={who ?? null} size="sm" decorative />}
              text={who ? who.name : "Sem responsável"}
              empty={!who}
            />
          )}
        </Prop>
        <Prop label="Equipe" icon="users">
          <PropButton
            label="Equipe"
            value={t.teamId ?? ""}
            empty="Sem equipe"
            icon="users"
            disabled={!edit}
            options={[
              { value: "", label: "Sem equipe" },
              ...p.teamIds.map((tid) => ({
                value: tid,
                label: db.teams.find((tm) => tm.id === tid)?.name ?? tid,
              })),
            ]}
            onChange={(v) => act.updateTask(id, { teamId: v || null })}
          />
        </Prop>
        <Prop label="Épico" icon="epic">
          {edit ? (
            <PropButton
              label="Épico"
              value={t.epicId ?? ""}
              empty="Sem épico"
              options={[
                { value: "", label: "Sem épico" },
                ...db.epics
                  .filter((e) => e.projectId === p.id)
                  .map((e) => ({ value: e.id, label: e.name, node: <TypeIcon type="epic" decorative /> })),
              ]}
              onChange={(v) => act.updateTask(id, { epicId: v || null })}
            />
          ) : (
            <PropValue
              node={epic ? <TypeIcon type="epic" decorative /> : undefined}
              text={epic ? epic.name : "Sem épico"}
              empty={!epic}
            />
          )}
        </Prop>
        <Prop label="Sprint" icon="sprint">
          {edit ? (
            <PropButton
              label="Sprint"
              value={t.sprintId ?? ""}
              empty="Sem sprint"
              icon="sprint"
              options={[
                { value: "", label: "Sem sprint" },
                ...db.sprints
                  .filter((s) => s.projectId === p.id && (s.status !== "done" || s.id === t.sprintId))
                  .map((s) => ({ value: s.id, label: `${s.name} (${SPRINT_ST[s.status]})` })),
              ]}
              onChange={(v) => act.updateTask(id, { sprintId: v || null })}
            />
          ) : (
            <PropValue text={sprint ? sprint.name : "Sem sprint"} empty={!sprint} />
          )}
        </Prop>
        <Prop label="Prazo" icon="calendar">
          <div className="pv-row">
            <input
              className="input"
              type="date"
              aria-label="Prazo"
              disabled={!edit}
              value={t.dueDate ?? ""}
              onChange={(e) => act.updateTask(id, { dueDate: e.target.value || null })}
            />
            {isOverdue(t) && dl !== null ? (
              <span className="chip danger">{-dl}d de atraso</span>
            ) : (
              t.dueDate &&
              t.status !== "done" &&
              dl !== null &&
              dl <= 2 && (
                <span className="chip warn">
                  {dl === 0 ? "Vence hoje" : dl === 1 ? "Vence amanhã" : `Vence em ${dl} dias`}
                </span>
              )
            )}
          </div>
        </Prop>
        <Prop label="Etiquetas" icon="tag">
          <div className="pv-row">
            {t.labels.map((l) => (
              <LabelChip key={l} name={l} />
            ))}
            {edit ? (
              <MenuButton
                className={`prop-btn${t.labels.length ? "" : " is-empty"}`}
                label={t.labels.length ? "Editar etiquetas" : "Adicionar etiquetas"}
                menuLabel="Etiquetas"
                items={() => [
                  "Etiquetas",
                  ...LABELS.map((l) => ({
                    label: labelName(l),
                    checked: t.labels.includes(l),
                    onClick: () => act.updateTask(id, { labels: toggle(t.labels, l) }),
                  })),
                ]}
              >
                <Icon name={t.labels.length ? "edit" : "plus"} size={13} />
                <span className="pv">{t.labels.length ? "Editar" : "Adicionar"}</span>
              </MenuButton>
            ) : (
              !t.labels.length && <span className="subtle">Sem etiquetas</span>
            )}
          </div>
        </Prop>
        <Prop label="Bloqueada por" icon="block">
          <div className="pv-row">
            {blockedBy.map((bt) =>
              openLink(
                bt,
                `chip${bt.status === "done" ? "" : " warn"}`,
                <span className="mono">{bt.ref}</span>,
              ),
            )}
            {edit ? (
              <MenuButton
                className={`prop-btn${t.blockedBy.length ? "" : " is-empty"}`}
                label={t.blockedBy.length ? "Editar bloqueios" : "Adicionar bloqueio"}
                menuLabel="Bloqueios"
                items={() => {
                  const candidates = db.tasks
                    .filter(
                      (x) =>
                        x.projectId === p.id &&
                        x.id !== t.id &&
                        !x.parentId &&
                        x.status !== "done" &&
                        !t.blockedBy.includes(x.id) &&
                        !wouldCycle(db, t.id, x.id),
                    )
                    .slice(0, 12);
                  return [
                    "Esta tarefa está bloqueada por…",
                    ...[...blockedBy, ...candidates].map((x) => ({
                      label: `${x.ref} — ${x.title.slice(0, 40)}`,
                      checked: t.blockedBy.includes(x.id),
                      sub: x.status === "done" ? "concluída — não bloqueia mais" : undefined,
                      onClick: () => act.updateTask(id, { blockedBy: toggle(t.blockedBy, x.id) }),
                    })),
                  ];
                }}
              >
                <Icon name={t.blockedBy.length ? "edit" : "plus"} size={13} />
                <span className="pv">{t.blockedBy.length ? "Editar" : "Adicionar"}</span>
              </MenuButton>
            ) : (
              !t.blockedBy.length && <span className="subtle">Nenhum</span>
            )}
          </div>
        </Prop>
        <Prop label="Criada" icon="clock">
          <span className="meta-line">
            {fmtDateTime(t.createdAt)} · atualizada {rel(t.updatedAt)}
          </span>
        </Prop>
      </div>

      <h2 className="section-h">Descrição</h2>
      <textarea
        className="textarea"
        placeholder="Sem descrição."
        aria-label="Descrição da tarefa"
        disabled={!edit}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        onBlur={() => {
          if (desc.trim() !== t.desc) act.updateTask(id, { desc: desc.trim() });
        }}
      />

      <h2 className="section-h">
        Critérios de aceite
        {t.acceptance.length > 0 && (
          <span className="sh-aside">
            {accDone}/{t.acceptance.length} atendidos
          </span>
        )}
      </h2>
      {t.acceptance.length > 0 ? (
        <Progress value={(100 * accDone) / t.acceptance.length} label="Critérios atendidos" />
      ) : (
        <p className="subtle">Nenhum critério definido.</p>
      )}
      {t.acceptance.map((a, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: criteria have no id; the text may repeat
        <label key={`${i}-${a.text}`} className={`acc-item${a.done ? " done" : ""}`}>
          <input
            type="checkbox"
            disabled={!edit}
            checked={a.done}
            onChange={(e) =>
              act.updateTask(id, {
                acceptance: t.acceptance.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)),
              })
            }
          />
          <span>{a.text}</span>
        </label>
      ))}
      {edit && (
        <div className="add-row">
          <input
            className="input"
            placeholder="Adicionar critério e Enter…"
            aria-label="Novo critério de aceite"
            enterKeyHint="enter"
            value={criterion}
            onChange={(e) => setCriterion(e.target.value)}
            onKeyDown={(e) => {
              if (!isEnter(e) || !criterion.trim()) return;
              e.preventDefault();
              act.updateTask(id, { acceptance: [...t.acceptance, { text: criterion.trim(), done: false }] });
              setCriterion("");
            }}
          />
        </div>
      )}

      {(subs.length > 0 || canAddSub) && (
        <>
          <h2 className="section-h">
            Subtarefas
            <span className="count">{subs.length}</span>
            {subs.length > 0 && (
              <span className="sh-aside">
                {subDone}/{subs.length} concluídas
              </span>
            )}
          </h2>
          {subs.length > 0 && (
            <div className="list sub-list">
              {subs.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className="list-item compact"
                  onClick={() => ui.openTask(s.id)}
                >
                  <StatusIcon status={s.status} label />
                  <span className="li-ref">{s.ref}</span>
                  <span className="li-main">
                    <span className="li-title">{s.title}</span>
                  </span>
                  <Avatar user={db.users.find((u) => u.id === s.assigneeId)} size="sm" />
                </button>
              ))}
            </div>
          )}
          {canAddSub && (
            <div className="add-row">
              <input
                className="input"
                placeholder="Nova subtarefa e Enter…"
                aria-label="Nova subtarefa"
                enterKeyHint="enter"
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                onKeyDown={(e) => {
                  if (!isEnter(e) || !sub.trim()) return;
                  e.preventDefault();
                  const typed = sub.trim();
                  void Promise.resolve(
                    act.createTask({
                      projectId: t.projectId,
                      parentId: t.id,
                      type: "subtask",
                      title: typed,
                      epicId: t.epicId,
                      sprintId: db.sprints.some((s) => s.id === t.sprintId && s.status !== "done")
                        ? t.sprintId
                        : null,
                      teamId: t.teamId,
                      silent: true,
                    }),
                  ).then((created) => {
                    if (created) setSub((current) => (current.trim() === typed ? "" : current));
                  });
                }}
              />
            </div>
          )}
        </>
      )}

      <h2 className="section-h">
        Comentários
        <span className="count">{comments.length}</span>
      </h2>
      {comments.map((c) => {
        const u = db.users.find((x) => x.id === c.userId);
        return (
          <div key={c.id} className="comment">
            <Avatar user={u} decorative />
            <div className="grow">
              <div className="c-head">
                <b>{u?.name ?? "?"}</b>
                <time dateTime={c.createdAt}>{rel(c.createdAt)}</time>
              </div>
              <p className="c-body">{c.text}</p>
            </div>
          </div>
        );
      })}
      {can("comment.create", t.projectId) && (
        <div className="comment-box">
          <textarea
            className="textarea"
            placeholder="Escreva um comentário…"
            aria-label="Novo comentário"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                sendComment();
              }
            }}
          />
          <div className="cb-foot">
            <span className="hint" aria-hidden="true">
              <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
              <kbd>Enter</kbd>
              envia
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={sendComment}>
              <Icon name="send" size={13} />
              Comentar
            </button>
          </div>
        </div>
      )}

      <h2 className="section-h">Histórico</h2>
      {!hist.length ? (
        <p className="subtle">Sem registros ainda.</p>
      ) : (
        <div className="timeline">
          {hist.map((a) => {
            const u = db.users.find((x) => x.id === a.userId);
            return (
              <div className="hist-item" key={a.id}>
                <span className={`tl-node ${SRC_NODE[a.source] ?? ""}`} aria-hidden="true">
                  <Icon name={srcIcon(a.source)} size={11} />
                </span>
                <span className="tl-txt">
                  <span className={`src-tag ${a.source}`}>{sourceLabel(a.source)}</span>{" "}
                  <b>{u?.name ?? "?"}</b> {a.summary}
                </span>
                <time dateTime={a.ts}>{rel(a.ts)}</time>
              </div>
            );
          })}
        </div>
      )}
    </Overlay>
  );
}
