import { useState } from "react";
import type { Priority, Project, TaskInput } from "../data/types";
import { useWorkspace } from "../data/workspace";
import { LABELS, navigate, PRIO_META, PRIORITIES } from "../lib/format";
import { Field, LabelChip, Overlay, Select, type TaskDefaults } from "./ui";
export function ProjectModal({ existing, onClose }: { existing?: Project; onClose: () => void }) {
  const { db, me, act } = useWorkspace();
  const [name, setName] = useState(existing?.name || ""),
    [key, setKey] = useState(existing?.key || ""),
    [desc, setDesc] = useState(existing?.desc || ""),
    [priority, setPriority] = useState<Priority>(existing?.priority || "medium"),
    [leadId, setLead] = useState(existing?.leadId || me.id),
    [startDate, setStart] = useState(existing?.startDate || new Date().toISOString().slice(0, 10)),
    [targetDate, setTarget] = useState(existing?.targetDate || ""),
    [status, setStatus] = useState<Project["status"]>(existing?.status || "active"),
    [teamIds, setTeams] = useState(existing?.teamIds || []),
    [errors, setErrors] = useState<Record<string, string>>({});
  const submit = () => {
    const er: Record<string, string> = {};
    if (!name.trim()) er.name = "Informe o nome do projeto";
    if (!existing && !/^[A-Z]{2,4}$/.test(key.trim().toUpperCase())) er.key = "Use 2 a 4 letras";
    else if (!existing && db.projects.some((p) => p.key === key.trim().toUpperCase()))
      er.key = "Chave já usada por outro projeto";
    if (targetDate && targetDate < startDate) er.target = "A entrega deve ser após o início";
    setErrors(er);
    if (Object.keys(er).length) return;
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
      act.updateProject(existing.id, { ...fields, status });
      onClose();
    } else {
      const p = act.createProject({ ...fields, key: key.trim().toUpperCase() });
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
          <button type="button" className="btn btn-primary" onClick={submit}>
            {existing ? "Salvar alterações" : "Criar projeto"}
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Nome do projeto" wide error={errors.name}>
          <input
            className="input"
            aria-label="Nome do projeto"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Chave" error={errors.key} hint="2 a 4 letras usadas nos identificadores (ex.: PCL-124)">
          <input
            className="input mono"
            aria-label="Chave"
            placeholder="ex.: PCL"
            maxLength={4}
            disabled={!!existing}
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Prioridade">
          <Select
            label="Prioridade"
            value={priority}
            onChange={(v) => setPriority(v as Priority)}
            options={PRIORITIES.map((value) => ({ value, label: PRIO_META[value].label }))}
          />
        </Field>
        <Field label="Responsável">
          <Select
            label="Responsável"
            value={leadId}
            onChange={setLead}
            options={db.users
              .filter(
                (u) =>
                  u.orgId === (existing?.orgId ?? me.orgId) && ["admin", "pm", "lead"].includes(u.roleId),
              )
              .map((u) => ({ value: u.id, label: u.name }))}
          />
        </Field>
        {existing ? (
          <Field label="Status">
            <Select
              label="Status"
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
        <Field label="Início">
          <input
            className="input"
            aria-label="Início"
            type="date"
            value={startDate}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Entrega prevista" error={errors.target}>
          <input
            className="input"
            aria-label="Entrega prevista"
            type="date"
            value={targetDate}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
        <Field label="Descrição" wide>
          <textarea
            className="textarea"
            aria-label="Descrição"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </Field>
        <Field label="Equipes associadas" wide>
          {db.teams
            .filter((tm) => tm.orgId === (existing?.orgId ?? me.orgId))
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
        </Field>
        <button type="submit" hidden />
      </form>
    </Overlay>
  );
}
export function TaskModal({ defaults = {}, onClose }: { defaults?: TaskDefaults; onClose: () => void }) {
  const { db, visibleProjects, act } = useWorkspace(),
    projects = visibleProjects.filter((p) => p.status !== "done");
  const [form, setForm] = useState<TaskInput>({
      projectId: defaults.projectId || projects[0]?.id || "",
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
    }),
    [accept, setAccept] = useState(""),
    [error, setError] = useState("");
  const update = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const project = db.projects.find((p) => p.id === form.projectId),
    members = db.users.filter(
      (u) =>
        project?.teamIds.some((tid) => db.teams.find((t) => t.id === tid)?.memberIds.includes(u.id)) &&
        !u.invited,
    );
  const submit = () => {
    if (!form.title.trim()) {
      setError("Informe o título da tarefa");
      return;
    }
    const t = act.createTask({
      ...form,
      title: form.title.trim(),
      acceptance: accept
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ text, done: false })),
    });
    if (t) onClose();
  };
  return (
    <Overlay
      title="Nova tarefa"
      wide
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!projects.length}>
            Criar tarefa
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Projeto" wide>
          <Select
            label="Projeto"
            value={form.projectId}
            onChange={(value) =>
              setForm((f) => ({ ...f, projectId: value, assigneeId: null, epicId: null, sprintId: null }))
            }
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field label="Título" wide error={error}>
          <input
            className="input"
            aria-label="Título"
            maxLength={120}
            placeholder="O que precisa ser feito?"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </Field>
        <Field label="Tipo">
          <Select
            label="Tipo"
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
            label="Prioridade"
            value={form.priority || "medium"}
            onChange={(v) => update("priority", v as Priority)}
            options={PRIORITIES.map((value) => ({ value, label: PRIO_META[value].label }))}
          />
        </Field>
        <Field label="Responsável">
          <Select
            label="Responsável"
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
            label="Épico"
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
            label="Sprint"
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
        <Field label="Vencimento">
          <input
            className="input"
            aria-label="Vencimento"
            type="date"
            value={form.dueDate || ""}
            onChange={(e) => update("dueDate", e.target.value || null)}
          />
        </Field>
        <Field label="Etiquetas" wide>
          {LABELS.map((l) => (
            <label
              key={l}
              className="check"
              style={{ display: "inline-flex", marginRight: 10, padding: "2px 0" }}
            >
              <input
                type="checkbox"
                checked={form.labels?.includes(l) || false}
                onChange={() =>
                  update(
                    "labels",
                    form.labels?.includes(l)
                      ? form.labels.filter((x) => x !== l)
                      : [...(form.labels || []), l],
                  )
                }
              />
              <LabelChip name={l} />
            </label>
          ))}
        </Field>
        <Field label="Descrição" wide>
          <textarea
            className="textarea"
            aria-label="Descrição"
            placeholder="Contexto, requisitos, links…"
            value={form.desc || ""}
            onChange={(e) => update("desc", e.target.value)}
          />
        </Field>
        <Field label="Critérios de aceite" wide>
          <textarea
            className="textarea"
            aria-label="Critérios de aceite"
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
