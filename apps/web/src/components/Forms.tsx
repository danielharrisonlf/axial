import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Priority, Project, TaskInput } from "../data/types";
import { useWorkspace } from "../data/workspace";
import { LABEL_META, LABELS, labelName, navigate, PRIO_META, PRIORITIES, todayLocal } from "../lib/format";
import { Field, FieldGroup, Overlay, Select, type TaskDefaults } from "./ui";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

/**
 * Validation on submit: after each attempt with errors, focus moves to the first invalid field
 * (the Field component marks it with aria-invalid and links the error by aria-describedby).
 */
function useFocusFirstInvalid() {
  const form = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attempt) form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [attempt]);
  return { form, failed: () => setAttempt((n) => n + 1) };
}
/** Ctrl/⌘+Enter submits the form from any field. */
const submitShortcut = (submit: () => void) => (e: KeyboardEvent<HTMLFormElement>) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    submit();
  }
};

export function ProjectModal({ existing, onClose }: { existing?: Project; onClose: () => void }) {
  const { db, me, act } = useWorkspace();
  const orgId = existing?.orgId ?? me.orgId;
  const [name, setName] = useState(existing?.name || "");
  const [key, setKey] = useState(existing?.key || "");
  const [desc, setDesc] = useState(existing?.desc || "");
  const [priority, setPriority] = useState<Priority>(existing?.priority || "medium");
  const [leadId, setLead] = useState(existing?.leadId || me.id);
  const [startDate, setStart] = useState(existing?.startDate || todayLocal());
  const [targetDate, setTarget] = useState(existing?.targetDate || "");
  const [status, setStatus] = useState<Project["status"]>(existing?.status || "active");
  const [teamIds, setTeams] = useState(existing?.teamIds || []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { form, failed } = useFocusFirstInvalid();
  // the current owner always stays an option, so saving without changes keeps it (audit CODE-05)
  const leads = db.users.filter(
    (u) =>
      u.id === existing?.leadId ||
      (!u.invited && u.orgId === orgId && ["admin", "pm", "lead"].includes(u.roleId)),
  );
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    const er: Record<string, string> = {};
    const k = key.trim().toUpperCase();
    if (!name.trim()) er.name = "Informe o nome do projeto";
    if (!existing) {
      if (!/^[A-Z]{2,4}$/.test(k)) er.key = "Use 2 a 4 letras";
      else if (db.projects.some((p) => p.key === k)) er.key = "Chave já usada por outro projeto";
    }
    if (!startDate) er.start = "Informe a data de início";
    if (startDate && targetDate && targetDate < startDate)
      er.target = "A entrega não pode ser anterior ao início";
    setErrors(er);
    if (Object.keys(er).length) {
      failed();
      return;
    }
    const fields = {
      name: name.trim(),
      desc: desc.trim(),
      priority,
      leadId,
      startDate,
      targetDate: targetDate || null,
      teamIds,
    };
    if (existing) {
      // optimistic in the API mode: the modal closes at once and a refusal rolls back with a toast
      void act.updateProject(existing.id, { ...fields, status });
      onClose();
    } else {
      setBusy(true);
      const p = await act.createProject({ ...fields, key: k });
      setBusy(false);
      if (p) {
        onClose();
        navigate(`/projects/${p.id}`);
      }
    }
  };
  return (
    <Overlay
      wide
      title={existing ? "Editar projeto" : "Novo projeto"}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {existing ? "Salvar alterações" : "Criar projeto"}
          </button>
        </>
      }
    >
      <form
        ref={form}
        className="form-grid"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Nome do projeto" wide required error={errors.name}>
          <input className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Chave"
          required={!existing}
          error={errors.key}
          hint="2 a 4 letras usadas nos identificadores (ex.: PCL-124)"
        >
          <input
            className="input mono"
            placeholder="ex.: PCL"
            maxLength={4}
            disabled={!!existing}
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Prioridade">
          <Select
            value={priority}
            onChange={(v) => setPriority(v as Priority)}
            options={PRIORITIES.map((value) => ({ value, label: PRIO_META[value].label }))}
          />
        </Field>
        <Field label="Responsável">
          <Select
            value={leadId}
            onChange={setLead}
            options={leads.map((u) => ({ value: u.id, label: u.name }))}
          />
        </Field>
        {existing ? (
          <Field label="Status">
            <Select
              value={status}
              onChange={(v) => setStatus(v as Project["status"])}
              options={[
                { value: "active", label: "Ativo" },
                { value: "paused", label: "Pausado" },
                { value: "done", label: "Concluído" },
              ]}
            />
          </Field>
        ) : (
          <span />
        )}
        <Field label="Início" required error={errors.start}>
          <input className="input" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Data de entrega" error={errors.target}>
          <input
            className="input"
            type="date"
            min={startDate || undefined}
            value={targetDate}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
        <Field label="Descrição" wide>
          <textarea className="textarea" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <FieldGroup label="Equipes associadas" wide>
          <div>
            {db.teams
              .filter((tm) => tm.orgId === orgId)
              .map((tm) => (
                <label className="check" key={tm.id}>
                  <input
                    type="checkbox"
                    checked={teamIds.includes(tm.id)}
                    onChange={() =>
                      setTeams(
                        teamIds.includes(tm.id) ? teamIds.filter((id) => id !== tm.id) : [...teamIds, tm.id],
                      )
                    }
                  />
                  <span>
                    {tm.name}
                    <span className="subtle"> — {tm.desc}</span>
                  </span>
                </label>
              ))}
          </div>
        </FieldGroup>
        <button type="submit" hidden />
      </form>
    </Overlay>
  );
}

const labelStyle = (name: string) =>
  ({ "--lc": LABEL_META[name] ? `var(--cat-${LABEL_META[name].cat})` : "var(--ink-3)" }) as CSSProperties;

export function TaskModal({ defaults = {}, onClose }: { defaults?: TaskDefaults; onClose: () => void }) {
  const { db, me, can, visibleProjects, act } = useWorkspace();
  // with a project id the API store applies the per-project policy (TEAM_LEAD: own teams only)
  const projects = visibleProjects.filter((p) => p.status !== "done" && can("task.create", p.id));
  const membersOf = (projectId: string) => {
    const project = db.projects.find((p) => p.id === projectId);
    return db.users.filter(
      (u) =>
        !u.invited &&
        project?.teamIds.some((tid) => db.teams.find((t) => t.id === tid)?.memberIds.includes(u.id)) &&
        (can("task.assign") || u.id === me.id),
    );
  };
  const firstProject =
    defaults.projectId && projects.some((p) => p.id === defaults.projectId)
      ? defaults.projectId
      : (projects[0]?.id ?? "");
  const [form, setForm] = useState<TaskInput>({
    projectId: firstProject,
    title: "",
    type: defaults.type || "task",
    priority: defaults.priority || "medium",
    assigneeId: defaults.assigneeId || null,
    epicId: defaults.epicId || null,
    sprintId: defaults.sprintId || null,
    dueDate: defaults.dueDate || null,
    desc: "",
    labels: [],
    status: defaults.status || "todo",
  });
  const [accept, setAccept] = useState("");
  const [error, setError] = useState("");
  const { form: formRef, failed } = useFocusFirstInvalid();
  const update = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const members = membersOf(form.projectId);
  const labels = form.labels ?? [];
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    if (!form.title.trim()) {
      setError("Informe o título da tarefa");
      failed();
      return;
    }
    setError("");
    setBusy(true);
    const t = await act.createTask({
      ...form,
      title: form.title.trim(),
      desc: form.desc?.trim() ?? "",
      acceptance: accept
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ text, done: false })),
    });
    setBusy(false);
    if (t) onClose();
  };
  return (
    <Overlay
      title="Nova tarefa"
      wide
      onClose={onClose}
      foot={
        <>
          <span className="foot-hint" aria-hidden="true">
            <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
            <kbd>Enter</kbd>
            cria a tarefa
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onClick={() => void submit()}
            disabled={!projects.length || busy}
          >
            Criar tarefa
          </button>
        </>
      }
    >
      <form
        ref={formRef}
        className="form-grid"
        noValidate
        onKeyDown={submitShortcut(() => void submit())}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Projeto" wide>
          <Select
            value={form.projectId}
            onChange={(value) =>
              setForm((f) => ({
                ...f,
                projectId: value,
                assigneeId: membersOf(value).some((u) => u.id === defaults.assigneeId)
                  ? (defaults.assigneeId ?? null)
                  : null,
                epicId: null,
                sprintId: null,
              }))
            }
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field label="Título" wide required error={error}>
          <input
            className="input"
            maxLength={120}
            placeholder="O que precisa ser feito?"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </Field>
        <Field label="Tipo">
          <Select
            value={form.type || "task"}
            onChange={(v) => update("type", v as TaskInput["type"])}
            options={[
              { value: "task", label: "Tarefa" },
              { value: "bug", label: "Bug" },
            ]}
          />
        </Field>
        <Field label="Prioridade">
          <Select
            value={form.priority || "medium"}
            onChange={(v) => update("priority", v as Priority)}
            options={PRIORITIES.map((value) => ({ value, label: PRIO_META[value].label }))}
          />
        </Field>
        <Field label="Responsável">
          <Select
            value={form.assigneeId || ""}
            onChange={(v) => update("assigneeId", v || null)}
            options={[
              { value: "", label: "Sem responsável" },
              ...members.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        </Field>
        <Field label="Épico">
          <Select
            value={form.epicId || ""}
            onChange={(v) => update("epicId", v || null)}
            options={[
              { value: "", label: "Sem épico" },
              ...db.epics
                .filter((e) => e.projectId === form.projectId)
                .map((e) => ({ value: e.id, label: e.name })),
            ]}
          />
        </Field>
        <Field label="Sprint">
          <Select
            value={form.sprintId || ""}
            onChange={(v) => update("sprintId", v || null)}
            options={[
              { value: "", label: "Sem sprint (backlog)" },
              ...db.sprints
                .filter((s) => s.projectId === form.projectId && s.status !== "done")
                .map((s) => ({ value: s.id, label: s.name + (s.status === "active" ? " (ativa)" : "") })),
            ]}
          />
        </Field>
        <Field label="Prazo">
          <input
            className="input"
            type="date"
            value={form.dueDate || ""}
            onChange={(e) => update("dueDate", e.target.value || null)}
          />
        </Field>
        <FieldGroup label="Etiquetas" wide>
          <div className="chip-toggles">
            {LABELS.map((l) => (
              <button
                key={l}
                type="button"
                className="label-chip"
                style={labelStyle(l)}
                aria-pressed={labels.includes(l)}
                onClick={() =>
                  update("labels", labels.includes(l) ? labels.filter((x) => x !== l) : [...labels, l])
                }
              >
                {labelName(l)}
              </button>
            ))}
          </div>
        </FieldGroup>
        <Field label="Descrição" wide>
          <textarea
            className="textarea"
            placeholder="Contexto, requisitos, links…"
            value={form.desc || ""}
            onChange={(e) => update("desc", e.target.value)}
          />
        </Field>
        <Field label="Critérios de aceite" wide>
          <textarea
            className="textarea"
            placeholder="Um critério de aceite por linha"
            value={accept}
            onChange={(e) => setAccept(e.target.value)}
          />
        </Field>
        <button hidden type="submit" />
      </form>
    </Overlay>
  );
}
