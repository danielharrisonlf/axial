import { Fragment, useState } from "react";
import type { Priority, Task, TaskStatus } from "../data/types";
import { useWorkspace } from "../data/workspace";
import {
  fmtDate,
  fmtDateTime,
  isOverdue,
  LABELS,
  PRIO_META,
  PRIORITIES,
  rel,
  STATUS_META,
  STATUSES,
} from "../lib/format";
import { Icon } from "./Icon";
import {
  Avatar,
  Empty,
  LabelChip,
  MenuButton,
  Overlay,
  PriorityChip,
  Select,
  StatusChip,
  StatusIcon,
  TypeIcon,
  useUI,
  Who,
} from "./ui";
export function TaskRow({ task: t, withDue = false }: { task: Task; withDue?: boolean }) {
  const { db } = useWorkspace(),
    ui = useUI();
  return (
    <button
      type="button"
      className="menu-item"
      style={{ borderRadius: 0, padding: "9px 14px", borderBottom: "1px solid var(--border)" }}
      onClick={() => ui.openTask(t.id)}
    >
      <StatusIcon status={t.status} />
      <TypeIcon type={t.type} />
      <span className="grow">
        {t.title}
        <span className="mi-sub">
          {t.ref} · {db.projects.find((p) => p.id === t.projectId)?.name}
          {withDue && t.dueDate ? ` · vence ${fmtDate(t.dueDate)}` : ""}
        </span>
      </span>
      {isOverdue(t) && <span className="chip danger">atrasada</span>}
      <PriorityChip priority={t.priority} bare />
      <Avatar user={db.users.find((u) => u.id === t.assigneeId)} size="sm" />
    </button>
  );
}
export function TaskTable({
  projectId,
  assigneeId,
  backlogMode = false,
}: {
  projectId?: string;
  assigneeId?: string;
  backlogMode?: boolean;
}) {
  const { db, visibleTasks, can } = useWorkspace(),
    ui = useUI();
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [prio, setPrio] = useState(""),
    [assignee, setAssignee] = useState(""),
    [sort, setSort] = useState(backlogMode ? "priority" : "due"),
    [dir, setDir] = useState(1),
    [page, setPage] = useState(0);
  const change = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(0);
  };
  const tasks = visibleTasks.filter(
    (t) =>
      !t.parentId &&
      (!projectId || t.projectId === projectId) &&
      (!assigneeId || t.assigneeId === assigneeId) &&
      (!backlogMode || (!t.sprintId && t.status !== "done")) &&
      (!status || t.status === status) &&
      (!prio || t.priority === prio) &&
      (!assignee || t.assigneeId === assignee) &&
      `${t.title} ${t.ref}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const key = (t: Task): string | number =>
    sort === "priority"
      ? PRIORITIES.indexOf(t.priority)
      : sort === "status"
        ? STATUSES.indexOf(t.status)
        : sort === "ref"
          ? t.ref
          : sort === "title"
            ? t.title.toLowerCase()
            : sort === "updated"
              ? t.updatedAt
              : t.dueDate || "9999";
  tasks.sort((a, b) => {
    const ka = key(a),
      kb = key(b);
    return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir;
  });
  const pages = Math.max(1, Math.ceil(tasks.length / 15)),
    current = Math.min(page, pages - 1);
  const th = (key: string, label: string) => (
    <th aria-sort={sort === key ? (dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="sort-button"
        onClick={() => {
          setSort(key);
          setDir(sort === key ? -dir : 1);
        }}
      >
        {label}
        {sort === key && <span className="arr">{dir === 1 ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
  return (
    <>
      <div className="fbar">
        <input
          className="input search"
          type="search"
          aria-label="Buscar tarefas"
          placeholder="Buscar título ou identificador…"
          value={q}
          onChange={(e) => change(setQ)(e.target.value)}
        />
        <Select
          label="Status"
          value={status}
          onChange={change(setStatus)}
          options={[
            { value: "", label: "Todos os status" },
            ...STATUSES.map((value) => ({ value, label: STATUS_META[value].label })),
          ]}
        />
        <Select
          label="Prioridade"
          value={prio}
          onChange={change(setPrio)}
          options={[
            { value: "", label: "Todas as prioridades" },
            ...PRIORITIES.map((value) => ({ value, label: PRIO_META[value].label })),
          ]}
        />
        {!assigneeId && (
          <Select
            label="Responsável"
            value={assignee}
            onChange={change(setAssignee)}
            options={[
              { value: "", label: "Todos os responsáveis" },
              ...db.users.filter((u) => !u.invited).map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        )}
        {(q || status || prio || assignee) && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setQ("");
              setStatus("");
              setPrio("");
              setAssignee("");
              setPage(0);
            }}
          >
            <Icon name="x" size={12} />
            Limpar
          </button>
        )}
      </div>
      {!tasks.length ? (
        <Empty title="Nenhuma tarefa encontrada" sub="Ajuste os filtros ou crie uma nova tarefa.">
          {can("task.create") && (
            <button type="button" className="btn btn-primary" onClick={() => ui.task({ projectId })}>
              <Icon name="plus" size={14} />
              Nova tarefa
            </button>
          )}
        </Empty>
      ) : (
        <div className="panel">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 34 }} />
                  {th("ref", "Ref")}
                  {th("title", "Título")}
                  {th("status", "Status")}
                  {th("priority", "Prioridade")}
                  <th>Responsável</th>
                  <th>{projectId ? "Sprint" : "Projeto"}</th>
                  {th("due", "Vencimento")}
                  {th("updated", "Atualizada")}
                </tr>
              </thead>
              <tbody>
                {tasks.slice(current * 15, current * 15 + 15).map((t) => (
                  <tr key={t.id} className="row-click" onClick={() => ui.openTask(t.id)}>
                    <td>
                      <TypeIcon type={t.type} />
                    </td>
                    <td className="mono nowrap">{t.ref}</td>
                    <td>
                      <div>
                        <button
                          type="button"
                          className="row-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            ui.openTask(t.id);
                          }}
                        >
                          {t.title}
                        </button>
                        {t.blockedBy.length > 0 && (
                          <span className="chip warn" style={{ marginLeft: 6 }}>
                            bloqueada
                          </span>
                        )}
                        <div className="label-list">
                          {t.labels.map((l) => (
                            <LabelChip key={l} name={l} />
                          ))}
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusChip status={t.status} />
                    </td>
                    <td>
                      <PriorityChip priority={t.priority} />
                    </td>
                    <td>
                      <Who key="assignee" id={t.assigneeId} />
                    </td>
                    <td>
                      {projectId
                        ? db.sprints.find((s) => s.id === t.sprintId)?.name || "—"
                        : db.projects.find((p) => p.id === t.projectId)?.name}
                    </td>
                    <td className="nowrap">
                      <span style={isOverdue(t) ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
                        {fmtDate(t.dueDate)}
                      </span>
                    </td>
                    <td className="nowrap muted" style={{ fontSize: 11.5 }}>
                      {rel(t.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="num">{tasks.length} tarefas</span>
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
export function TaskDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { db, can, canTouchTask, act } = useWorkspace(),
    ui = useUI();
  const [comment, setComment] = useState(""),
    [sub, setSub] = useState(""),
    [criterion, setCriterion] = useState("");
  const t = db.tasks.find((t) => t.id === id);
  if (!t) return null;
  const p = db.projects.find((p) => p.id === t.projectId);
  if (!p) return null;
  const edit = canTouchTask(t),
    members = db.users.filter(
      (u) =>
        p.teamIds.some((id) => db.teams.find((tm) => tm.id === id)?.memberIds.includes(u.id)) && !u.invited,
    ),
    subs = db.tasks.filter((s) => s.parentId === id);
  const props = [
    [
      "Status",
      <Select
        key="status"
        label="Status da tarefa"
        value={t.status}
        disabled={!edit || !can("task.move")}
        onChange={(v) => act.moveTask(id, v as TaskStatus)}
        options={STATUSES.map((value) => ({ value, label: STATUS_META[value].label }))}
      />,
    ],
    [
      "Prioridade",
      <Select
        key="priority"
        label="Prioridade da tarefa"
        value={t.priority}
        disabled={!edit}
        onChange={(v) => act.updateTask(id, { priority: v as Priority })}
        options={PRIORITIES.map((value) => ({ value, label: PRIO_META[value].label }))}
      />,
    ],
    [
      "Responsável",
      edit && (can("task.assign") || !t.assigneeId) ? (
        <Select
          key="assignee"
          label="Responsável da tarefa"
          value={t.assigneeId || ""}
          onChange={(v) => act.updateTask(id, { assigneeId: v || null })}
          options={[
            { value: "", label: "Sem responsável" },
            ...members.map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
      ) : (
        <Who key="assignee" id={t.assigneeId} />
      ),
    ],
    [
      "Equipe",
      <Select
        key="team"
        label="Equipe da tarefa"
        value={t.teamId || ""}
        disabled={!edit}
        onChange={(v) => act.updateTask(id, { teamId: v || null })}
        options={[
          { value: "", label: "Sem equipe" },
          ...db.teams
            .filter((tm) => p.teamIds.includes(tm.id))
            .map((tm) => ({ value: tm.id, label: tm.name })),
        ]}
      />,
    ],
    [
      "Épico",
      <Select
        key="epic"
        label="Épico da tarefa"
        value={t.epicId || ""}
        disabled={!edit}
        onChange={(v) => act.updateTask(id, { epicId: v || null })}
        options={[
          { value: "", label: "Sem épico" },
          ...db.epics.filter((e) => e.projectId === p.id).map((e) => ({ value: e.id, label: e.name })),
        ]}
      />,
    ],
    [
      "Sprint",
      <Select
        key="sprint"
        label="Sprint da tarefa"
        value={t.sprintId || ""}
        disabled={!edit}
        onChange={(v) => act.updateTask(id, { sprintId: v || null })}
        options={[
          { value: "", label: "Sem sprint" },
          ...db.sprints.filter((s) => s.projectId === p.id).map((s) => ({ value: s.id, label: s.name })),
        ]}
      />,
    ],
    [
      "Vencimento",
      <div className="inline-row" key="due">
        <input
          className="input"
          aria-label="Vencimento da tarefa"
          type="date"
          disabled={!edit}
          value={t.dueDate || ""}
          onChange={(e) => act.updateTask(id, { dueDate: e.target.value || null })}
        />
        {isOverdue(t) && <span className="chip danger">atrasada</span>}
      </div>,
    ],
    [
      "Projeto",
      <a key="project" href={`#/projects/${p.id}`} onClick={onClose}>
        {p.name}
      </a>,
    ],
    [
      "Criada",
      <span key="created" className="muted" style={{ fontSize: 12 }}>
        {fmtDateTime(t.createdAt)} · atualizada {rel(t.updatedAt)}
      </span>,
    ],
  ] as const;
  return (
    <Overlay
      drawer
      title={
        <span className="inline-row">
          <TypeIcon type={t.type} size={16} />
          <span className="mono" style={{ color: "var(--ink-2)" }}>
            {t.ref}
          </span>
        </span>
      }
      onClose={onClose}
      headActions={
        <MenuButton
          label="Ações da tarefa"
          items={[
            {
              label: "Copiar identificador",
              icon: "copy",
              onClick: () => {
                void navigator.clipboard.writeText(t.ref);
              },
            },
            ...(can("task.delete") && edit
              ? [
                  {
                    label: "Excluir tarefa…",
                    icon: "trash",
                    danger: true,
                    onClick: () =>
                      ui.confirm(
                        "Excluir tarefa",
                        `Remove ${t.ref} e suas subtarefas (simulação). Não pode ser desfeito.`,
                        () => {
                          act.deleteTask(id);
                          onClose();
                        },
                        "Excluir",
                      ),
                  },
                ]
              : []),
          ]}
        >
          <Icon name="dots" />
        </MenuButton>
      }
    >
      <textarea
        key={`${id}title`}
        className="textarea task-title-input"
        aria-label="Título da tarefa"
        disabled={!edit}
        defaultValue={t.title}
        onBlur={(e) => {
          if (e.target.value.trim() && e.target.value.trim() !== t.title)
            act.updateTask(id, { title: e.target.value.trim() });
        }}
      />
      {!edit && (
        <p className="subtle" style={{ fontSize: 11.5, margin: "4px 0 0" }}>
          <Icon name="block" size={11} /> Somente leitura para o perfil atual.
        </p>
      )}
      {t.blockedBy.length > 0 && (
        <div className="chip warn" style={{ marginTop: 8 }}>
          <Icon name="block" size={12} />
          Bloqueada por{" "}
          {t.blockedBy.map((bid) => (
            <button
              type="button"
              className="btn btn-ghost btn-sm mono"
              key={bid}
              onClick={() => ui.openTask(bid)}
            >
              {db.tasks.find((x) => x.id === bid)?.ref}
            </button>
          ))}
        </div>
      )}
      <div className="task-props">
        {props.map(([label, node]) => (
          <Fragment key={label}>
            <span className="pl">{label}</span>
            {node}
          </Fragment>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {t.labels.map((l) => (
          <LabelChip key={l} name={l} />
        ))}
        {edit && (
          <>
            <MenuButton
              label="Editar etiquetas"
              className="btn btn-ghost btn-sm"
              items={LABELS.map((l) => ({
                label: l,
                checked: t.labels.includes(l),
                onClick: () =>
                  act.updateTask(id, {
                    labels: t.labels.includes(l) ? t.labels.filter((x) => x !== l) : [...t.labels, l],
                  }),
              }))}
            >
              <Icon name="tag" size={13} />
              Etiquetas
            </MenuButton>
            <MenuButton
              label="Dependência"
              className="btn btn-ghost btn-sm"
              items={db.tasks
                .filter((x) => x.projectId === p.id && x.id !== id && !x.parentId && x.status !== "done")
                .slice(0, 12)
                .map((x) => ({
                  label: `${x.ref} — ${x.title}`,
                  checked: t.blockedBy.includes(x.id),
                  onClick: () =>
                    act.updateTask(id, {
                      blockedBy: t.blockedBy.includes(x.id)
                        ? t.blockedBy.filter((b) => b !== x.id)
                        : [...t.blockedBy, x.id],
                    }),
                }))}
            >
              <Icon name="block" size={13} />
              Dependência
            </MenuButton>
          </>
        )}
      </div>
      <div className="section-h">Descrição</div>
      <textarea
        key={`${id}desc`}
        className="textarea"
        aria-label="Descrição da tarefa"
        disabled={!edit}
        defaultValue={t.desc || ""}
        onBlur={(e) => {
          if (e.target.value !== t.desc) act.updateTask(id, { desc: e.target.value });
        }}
      />
      <div className="section-h">
        Critérios de aceite{" "}
        <span className="chip">
          {t.acceptance.filter((a) => a.done).length}/{t.acceptance.length}
        </span>
      </div>
      {t.acceptance.map((a, i) => (
        <label key={a.text} className="acc-item">
          <input
            type="checkbox"
            disabled={!edit}
            checked={a.done}
            onChange={() =>
              act.updateTask(id, {
                acceptance: t.acceptance.map((x, j) => (j === i ? { ...x, done: !x.done } : x)),
              })
            }
          />
          <span style={a.done ? { textDecoration: "line-through", color: "var(--ink-3)" } : undefined}>
            {a.text}
          </span>
        </label>
      ))}
      {!t.acceptance.length && (
        <p className="subtle" style={{ fontSize: 12 }}>
          Nenhum critério definido.
        </p>
      )}
      {edit && (
        <form
          className="inline-row"
          style={{ marginTop: 7 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (criterion.trim()) {
              act.updateTask(id, { acceptance: [...t.acceptance, { text: criterion.trim(), done: false }] });
              setCriterion("");
            }
          }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Adicionar critério e Enter…"
            aria-label="Novo critério de aceite"
            value={criterion}
            onChange={(e) => setCriterion(e.target.value)}
          />
          <button type="submit" className="btn btn-sm" aria-label="Adicionar critério">
            <Icon name="plus" size={13} />
          </button>
        </form>
      )}
      <div className="section-h">
        Subtarefas{" "}
        <span className="chip">
          {subs.filter((s) => s.status === "done").length}/{subs.length}
        </span>
      </div>
      {subs.map((s) => (
        <button type="button" key={s.id} className="menu-item" onClick={() => ui.openTask(s.id)}>
          <StatusIcon status={s.status} />
          <span className="mono subtle">{s.ref}</span>
          <span className="grow">{s.title}</span>
          <Avatar user={db.users.find((u) => u.id === s.assigneeId)} size="sm" />
        </button>
      ))}
      {edit && can("task.create") && !t.parentId && (
        <form
          className="inline-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (sub.trim()) {
              act.createTask({
                projectId: p.id,
                parentId: id,
                type: "subtask",
                title: sub.trim(),
                epicId: t.epicId,
                sprintId: t.sprintId,
                teamId: t.teamId,
              });
              setSub("");
            }
          }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Nova subtarefa e Enter…"
            aria-label="Nova subtarefa"
            value={sub}
            onChange={(e) => setSub(e.target.value)}
          />
          <button type="submit" className="btn btn-sm" aria-label="Adicionar subtarefa">
            <Icon name="plus" size={13} />
          </button>
        </form>
      )}
      <div className="section-h">Comentários</div>
      {db.comments
        .filter((c) => c.taskId === id)
        .map((c) => (
          <div key={c.id} className="comment">
            <Avatar user={db.users.find((u) => u.id === c.userId)} size="sm" />
            <div>
              <div>
                <b>{db.users.find((u) => u.id === c.userId)?.name}</b>
                <time>{rel(c.createdAt)}</time>
              </div>
              <p style={{ whiteSpace: "pre-wrap" }}>{c.text}</p>
            </div>
          </div>
        ))}
      {can("task.create") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (comment.trim()) {
              act.addComment(id, comment.trim());
              setComment("");
            }
          }}
        >
          <textarea
            className="textarea"
            aria-label="Novo comentário"
            placeholder="Escreva um comentário…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            style={{ marginTop: 8 }}
            disabled={!comment.trim()}
          >
            Comentar
          </button>
        </form>
      )}
      <div className="section-h">Histórico</div>
      {db.audit
        .filter((a) => a.entityType === "task" && a.entityId === id)
        .slice(0, 8)
        .map((a) => (
          <div className="hist-item" key={a.id}>
            <Avatar user={db.users.find((u) => u.id === a.userId)} size="sm" />
            <span>{a.summary}</span>
            <time>{rel(a.ts)}</time>
          </div>
        ))}
    </Overlay>
  );
}
