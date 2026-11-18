import { useState } from "react";
import { Icon } from "../components/Icon";
import { announce, Field, PageHead, TabNav } from "../components/ui";
import { apiBaseUrl } from "../data/api/http";
import type { Priority, Project, Task, TaskStatus } from "../data/types";
import { useWorkspace, workspaceStore } from "../data/workspace";
import { isOverdue, PRIORITIES, projectProgress, STATUSES, sourceLabel, ymd } from "../lib/format";
import { useSession } from "../session";

/* ==========================================================================
   Catálogo: espelha as ferramentas registradas em apps/mcp-server/src/tools.ts
   (nome, tipo pelo readOnlyHint, descrição traduzida e parâmetros do schema zod).
   A permissão exigida é a capacidade do ms-projects que autoriza a chamada.
   ========================================================================== */

type Args = Record<string, unknown>;
type Workspace = ReturnType<typeof useWorkspace>;
interface ToolDef {
  name: string;
  kind: "read" | "write";
  desc: string;
  cap: string;
  params: string[];
  example: (ws: Workspace) => Args;
}

const firstProject = (ws: Workspace) => ws.visibleProjects[0];
/**
 * Optimistic concurrency, as the real API: the demo store has no version column, so the version is
 * derived the same way everywhere — 1 plus the recorded changes to the task (comments excluded).
 */
const taskVersion = (ws: Pick<Workspace, "db">, taskId: string) =>
  1 +
  ws.db.audit.filter(
    (a) =>
      a.entityType === "task" && a.entityId === taskId && a.action !== "create" && a.action !== "comment",
  ).length;
const firstTask = (ws: Workspace) =>
  ws.visibleTasks.find((t) => !t.parentId && t.status !== "done" && ws.canTouchTask(t)) ??
  ws.visibleTasks.find((t) => !t.parentId);

const TOOLS: ToolDef[] = [
  {
    name: "list-projects",
    kind: "read",
    desc: "Lista os projetos que o chamador pode ver. Use para encontrar o id de um projeto antes de ler suas tarefas ou sprints.",
    cap: "project.view",
    params: ["search?: string (até 160)", "page?: inteiro ≥ 1", "pageSize?: inteiro 1–100"],
    example: () => ({ search: "", page: 1, pageSize: 10 }),
  },
  {
    name: "get-project",
    kind: "read",
    desc: "Lê um projeto pelo id, com status, datas e resumo de entrega.",
    cap: "project.view",
    params: ["projectId: uuid"],
    example: (ws) => ({ projectId: firstProject(ws)?.id ?? "" }),
  },
  {
    name: "project-summary",
    kind: "read",
    desc: "Lê o resumo de tarefas e sprints de um projeto.",
    cap: "project.view",
    params: ["projectId: uuid"],
    example: (ws) => ({ projectId: firstProject(ws)?.id ?? "" }),
  },
  {
    name: "list-tasks",
    kind: "read",
    desc: "Lista as tarefas de um projeto, com filtro opcional por status, responsável ou texto.",
    cap: "task.view",
    params: [
      "projectId: uuid",
      "status?: backlog|todo|in_progress|in_review|done",
      "assigneeId?: uuid",
      "search?: string (até 240)",
      "page?: inteiro ≥ 1",
      "pageSize?: inteiro 1–100",
    ],
    example: (ws) => ({ projectId: firstProject(ws)?.id ?? "", status: "in_progress" }),
  },
  {
    name: "get-task",
    kind: "read",
    desc: "Lê uma tarefa pelo id, com descrição, etiquetas e dependências.",
    cap: "task.view",
    params: ["taskId: uuid"],
    example: (ws) => ({ taskId: firstTask(ws)?.id ?? "" }),
  },
  {
    name: "create-task",
    kind: "write",
    desc: "Cria uma tarefa em um projeto. Altera dados: confirme o projeto e o título com o usuário antes de chamar.",
    cap: "task.create",
    params: [
      "projectId: uuid",
      "title: string (1–240)",
      "description?: string (markdown)",
      "status?: backlog|todo|in_progress|in_review|done",
      "priority?: low|medium|high|urgent",
      "assigneeId?: uuid | null",
      "dueDate?: data ISO 8601 com fuso | null",
    ],
    example: (ws) => ({
      projectId: firstProject(ws)?.id ?? "",
      title: "Revisar critérios de aceite com o cliente",
      priority: "high",
    }),
  },
  {
    name: "update-task-status",
    kind: "write",
    desc: "Move uma tarefa para outro status do Kanban. Altera dados e exige a versão atual da tarefa.",
    cap: "task.move",
    params: ["taskId: uuid", "status: backlog|todo|in_progress|in_review|done", "version: inteiro ≥ 1"],
    example: (ws) => {
      const t = firstTask(ws);
      return { taskId: t?.id ?? "", status: "in_review", version: t ? taskVersion(ws, t.id) : 1 };
    },
  },
  {
    name: "list-sprints",
    kind: "read",
    desc: "Lista as sprints de um projeto com status e período.",
    cap: "sprint.view",
    params: ["projectId: uuid"],
    example: (ws) => ({ projectId: firstProject(ws)?.id ?? "" }),
  },
];
const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

/* ==========================================================================
   Execução local: lê e altera os dados do Workspace com o perfil ativo.
   Fora do escopo do perfil, projeto e tarefa respondem como inexistentes.
   ========================================================================== */
class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (code: string, message: string): never => {
  throw new ToolError(code, message);
};

function str(args: Args, key: string, opts: { required?: boolean; max?: number; min?: number } = {}) {
  const value = args[key];
  if (value === undefined) {
    if (opts.required) fail("invalid_args", `${key} é obrigatório.`);
    return undefined;
  }
  if (typeof value !== "string") return fail("invalid_args", `${key} deve ser texto.`);
  const text = value.trim();
  if (opts.min !== undefined && text.length < opts.min) fail("invalid_args", `${key} não pode ficar vazio.`);
  if (opts.max !== undefined && value.length > opts.max)
    fail("invalid_args", `${key} aceita até ${opts.max} caracteres.`);
  return value;
}
function int(args: Args, key: string, opts: { required?: boolean; min?: number; max?: number } = {}) {
  const value = args[key];
  if (value === undefined) {
    if (opts.required) fail("invalid_args", `${key} é obrigatório.`);
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value))
    return fail("invalid_args", `${key} deve ser um número inteiro.`);
  if ((opts.min !== undefined && value < opts.min) || (opts.max !== undefined && value > opts.max))
    fail("invalid_args", `${key} deve estar entre ${opts.min ?? "-∞"} e ${opts.max ?? "∞"}.`);
  return value;
}
function oneOf<T extends string>(args: Args, key: string, values: readonly T[], required = false) {
  const value = str(args, key, { required });
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) fail("invalid_args", `${key} deve ser um de: ${values.join(", ")}.`);
  return value as T;
}
function paged<T>(items: T[], args: Args) {
  const page = int(args, "page", { min: 1 }) ?? 1;
  const pageSize = int(args, "pageSize", { min: 1, max: 100 }) ?? 25;
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize,
  };
}

async function execute(ws: Workspace, name: string, args: Args): Promise<unknown> {
  const tool = toolByName(name) ?? fail("unknown_tool", `Ferramenta desconhecida: ${name}.`);
  const { db, can, act } = ws;
  if (!can(tool.cap))
    fail("permission_denied", `O papel atual não pode usar ${tool.name} (requer ${tool.cap}).`);
  const project = (key = "projectId"): Project => {
    const id = str(args, key, { required: true });
    return (
      ws.visibleProjects.find((p) => p.id === id) ??
      fail("not_found", "Projeto não encontrado ou sem acesso.")
    );
  };
  const task = (): Task => {
    const id = str(args, "taskId", { required: true });
    return (
      ws.visibleTasks.find((t) => t.id === id) ?? fail("not_found", "Tarefa não encontrada ou sem acesso.")
    );
  };
  const userName = (id: string | null) => db.users.find((u) => u.id === id)?.name ?? null;
  const taskJson = (t: Task) => ({
    id: t.id,
    ref: t.ref,
    projectId: t.projectId,
    title: t.title,
    type: t.type,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assigneeId,
    assignee: userName(t.assigneeId),
    sprintId: t.sprintId,
    dueDate: t.dueDate,
    updatedAt: t.updatedAt,
    version: taskVersion(ws, t.id),
  });

  switch (tool.name) {
    case "list-projects": {
      const search = str(args, "search", { max: 160 })?.trim().toLowerCase();
      const list = ws.visibleProjects
        .filter(
          (p) => !search || p.name.toLowerCase().includes(search) || p.key.toLowerCase().includes(search),
        )
        .map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          status: p.status,
          priority: p.priority,
          startDate: p.startDate,
          targetDate: p.targetDate,
        }));
      return paged(list, args);
    }
    case "get-project": {
      const p = project();
      const tasks = db.tasks.filter((t) => t.projectId === p.id && !t.parentId);
      return {
        id: p.id,
        key: p.key,
        name: p.name,
        description: p.desc,
        status: p.status,
        priority: p.priority,
        lead: userName(p.leadId),
        startDate: p.startDate,
        targetDate: p.targetDate,
        delivery: {
          tasks: tasks.length,
          done: tasks.filter((t) => t.status === "done").length,
          completionPercent: projectProgress(db, p.id),
        },
      };
    }
    case "project-summary": {
      const p = project();
      const tasks = db.tasks.filter((t) => t.projectId === p.id && !t.parentId);
      const byStatus: Record<string, number> = {};
      for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      const sprints = db.sprints.filter((s) => s.projectId === p.id);
      const active = sprints.find((s) => s.status === "active");
      return {
        projectId: p.id,
        total: tasks.length,
        done: byStatus.done ?? 0,
        byStatus,
        overdue: tasks.filter(isOverdue).length,
        completionPercent: projectProgress(db, p.id),
        sprints: {
          planned: sprints.filter((s) => s.status === "planned").length,
          active: active ? { id: active.id, name: active.name, endDate: active.endDate } : null,
          done: sprints.filter((s) => s.status === "done").length,
        },
      };
    }
    case "list-tasks": {
      const p = project();
      const status = oneOf(args, "status", STATUSES);
      const assigneeId = str(args, "assigneeId");
      const search = str(args, "search", { max: 240 })?.trim().toLowerCase();
      const list = ws.visibleTasks
        .filter(
          (t) =>
            t.projectId === p.id &&
            (!status || t.status === status) &&
            (!assigneeId || t.assigneeId === assigneeId) &&
            (!search || t.title.toLowerCase().includes(search) || t.ref.toLowerCase().includes(search)),
        )
        .map(taskJson);
      return paged(list, args);
    }
    case "get-task": {
      const t = task();
      const refOf = (id: string) => db.tasks.find((x) => x.id === id)?.ref ?? id;
      return {
        ...taskJson(t),
        description: t.desc,
        labels: t.labels,
        acceptance: t.acceptance.map((a) => ({ text: a.text, done: a.done })),
        blockedBy: t.blockedBy.map((id) => ({ id, ref: refOf(id) })),
        parentId: t.parentId,
        createdAt: t.createdAt,
      };
    }
    case "create-task": {
      const p = project();
      const title = str(args, "title", { required: true, min: 1, max: 240 }) ?? "";
      const description = str(args, "description", { max: 20_000 });
      const status = oneOf<TaskStatus>(args, "status", STATUSES);
      const priority = oneOf<Priority>(args, "priority", PRIORITIES);
      const assigneeId = args.assigneeId === null ? null : str(args, "assigneeId");
      if (assigneeId && !db.users.some((u) => u.id === assigneeId && u.orgId === p.orgId && u.active))
        fail("invalid_args", "assigneeId não pertence à organização do projeto.");
      let dueDate: string | null | undefined;
      if (args.dueDate === null) dueDate = null;
      else {
        const raw = str(args, "dueDate");
        if (raw !== undefined) {
          const when = new Date(raw);
          if (!/^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:\d{2})$/.test(raw) || Number.isNaN(when.getTime()))
            fail(
              "invalid_args",
              "dueDate deve ser uma data ISO 8601 com fuso (ex.: 2026-12-01T18:00:00-03:00).",
            );
          dueDate = ymd(when);
        }
      }
      const created = await act.runAs("mcp", () =>
        act.createTask({
          projectId: p.id,
          title: title.trim(),
          desc: description ?? "",
          status: status ?? "backlog",
          priority: priority ?? "medium",
          assigneeId: assigneeId ?? null,
          dueDate: dueDate ?? null,
          silent: true,
        }),
      );
      if (!created) return fail("rejected", "O armazenamento recusou a tarefa; veja o aviso exibido.");
      ws.notify("MCP criou uma tarefa", `${created.ref} — ${created.title}`, "ok");
      return { ...taskJson(created), description: created.desc };
    }
    case "update-task-status": {
      const t = task();
      const status = oneOf<TaskStatus>(args, "status", STATUSES, true) ?? t.status;
      const version = int(args, "version", { required: true, min: 1 });
      if (!ws.canTouchTask(t)) fail("permission_denied", `O perfil atual não pode alterar ${t.ref}.`);
      const current = taskVersion(ws, t.id);
      if (version !== current)
        fail(
          "version_conflict",
          `${t.ref} mudou desde a leitura (versão atual ${current}, enviada ${version}). Leia de novo com get-task.`,
        );
      await act.runAs("mcp", () => act.moveTask(t.id, status));
      const after = workspaceStore.getSnapshot().db.tasks.find((x) => x.id === t.id);
      if (!after || after.status !== status)
        return fail("rejected", "O armazenamento recusou a mudança de status; veja o aviso exibido.");
      // the version comes from the store after the write (ws is the snapshot before it)
      return {
        ...taskJson(after),
        version: taskVersion({ db: workspaceStore.getSnapshot().db }, after.id),
        previousStatus: t.status,
      };
    }
    case "list-sprints": {
      const p = project();
      return {
        items: db.sprints
          .filter((s) => s.projectId === p.id)
          .map((s) => ({
            id: s.id,
            name: s.name,
            goal: s.goal,
            status: s.status,
            startDate: s.startDate,
            endDate: s.endDate,
          })),
      };
    }
    default:
      return fail("unknown_tool", `Ferramenta desconhecida: ${name}.`);
  }
}

/* ==========================================================================
   Página
   ========================================================================== */
export function Mcp({ tab }: { tab?: string }) {
  const { me } = useWorkspace();
  const active = tab === "test" || tab === "connect" ? tab : "tools";
  return (
    <>
      <PageHead
        title="Agentes e integração MCP"
        sub="Ferramentas que o mcp-server oferece a agentes de IA autorizados. No console, execute qualquer uma com as permissões do perfil ativo; as de escrita alteram os dados e entram na auditoria."
      />
      <TabNav
        label="Seções de agentes MCP"
        items={[
          { key: "tools", label: `Ferramentas (${TOOLS.length})` },
          { key: "test", label: "Testar ferramenta" },
          { key: "connect", label: "Conectar um agente" },
        ]}
        active={active}
        base="/mcp/"
      />
      {active === "tools" ? <Catalog /> : active === "connect" ? <Connect /> : <Console key={me.id} />}
    </>
  );
}

/** Address of the MCP server from the build configuration (VITE_API_BASE_URL); same origin when empty. */
export function mcpServerUrl(): string {
  return `${apiBaseUrl() || window.location.origin}/mcp`;
}

/** Copy button with an accessible name and a visible, announced "Copiado" confirmation. */
function CopyButton({ text, what }: { text: string; what: string }) {
  const { notify } = useWorkspace();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const fail = () => notify("Não foi possível copiar", "Selecione o texto e copie manualmente.", "warn");
    if (!navigator.clipboard?.writeText) return fail();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      announce(`${what} copiado.`);
      setTimeout(() => setCopied(false), 2000);
    }, fail);
  };
  return (
    <button type="button" className="btn btn-sm" aria-label={`Copiar ${what}`} onClick={copy}>
      <Icon name={copied ? "check" : "copy"} size={13} />
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

/** Code block with a copy button; `wrap` lets one-line commands break instead of scrolling sideways. */
function Snippet({ text, what, wrap = false }: { text: string; what: string; wrap?: boolean }) {
  return (
    <div className="mcp-snippet">
      <pre className={`code${wrap ? " wrap" : ""}`} data-copy={what}>
        {text}
      </pre>
      <CopyButton text={text} what={what} />
    </div>
  );
}

/** How to connect Claude, ChatGPT or Cursor (deploy/README.md, "Conectar o MCP"). */
function Connect() {
  const url = mcpServerUrl();
  const cursor = JSON.stringify({ mcpServers: { kairos: { url } } }, null, 2);
  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <h2>Endereço do servidor MCP</h2>
        </div>
        <div className="panel-body">
          <p className="muted">
            Cole só este endereço no cliente. Ele descobre o login do Kairos sozinho: você entra com o seu
            e-mail e a sua senha, e o agente passa a agir com as permissões do seu papel.
          </p>
          <Snippet text={url} what="endereço do servidor MCP" wrap />
        </div>
      </div>
      <div className="grid c2">
        <div className="panel">
          <div className="panel-head">
            <h2>Claude Code</h2>
          </div>
          <div className="panel-body">
            <p className="muted">No terminal:</p>
            <Snippet
              text={`claude mcp add --scope user --transport http kairos ${url}`}
              what="comando do Claude Code"
              wrap
            />
            <p className="muted mt-3">
              Com <span className="mono">--scope user</span> o servidor vale em qualquer pasta; sem ele, só na
              pasta onde o comando foi executado. Depois, abra uma nova sessão do Claude Code e use{" "}
              <kbd>/mcp</kbd> → <b>kairos</b> → <b>Authenticate</b>. O navegador abre a página de login do
              Kairos.
            </p>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Claude (web e Desktop)</h2>
          </div>
          <div className="panel-body">
            <p className="muted">
              Configurações → Conectores → Adicionar conector personalizado → cole o endereço acima → Conectar
              e entre com o seu acesso do Kairos. Em planos Team ou Enterprise, um proprietário adiciona o
              conector para a organização. O Claude Desktop usa os conectores da conta.
            </p>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>ChatGPT</h2>
          </div>
          <div className="panel-body">
            <p className="muted">
              Configurações → Apps e conectores → Configurações avançadas → ative o modo desenvolvedor. Depois
              crie um conector com o endereço acima e autenticação OAuth. A disponibilidade depende do plano.
            </p>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Cursor</h2>
          </div>
          <div className="panel-body">
            <p className="muted">
              Em <span className="mono">~/.cursor/mcp.json</span> (ou{" "}
              <span className="mono">.cursor/mcp.json</span> do projeto):
            </p>
            <Snippet text={cursor} what="configuração do Cursor" />
            <p className="muted mt-3">Em Settings → MCP, clique em Login no servidor kairos.</p>
          </div>
        </div>
      </div>
      <div className="banner info">
        <Icon name="info" size={16} />
        <span>
          Requisitos: conta ativa numa empresa e senha provisória já trocada no Workspace. Quem participa de
          mais de uma empresa escolhe a empresa no login do agente. Para desconectar, remova o conector no
          cliente.
        </span>
      </div>
    </div>
  );
}

function Catalog() {
  const session = useSession();
  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Ferramenta</th>
              <th>Tipo</th>
              <th>Descrição</th>
              <th>Permissão exigida</th>
              <th>Parâmetros</th>
            </tr>
          </thead>
          <tbody>
            {TOOLS.map((tool) => (
              <tr key={tool.name}>
                <td className="mono nowrap">{tool.name}</td>
                <td>
                  <span className={`chip ${tool.kind === "write" ? "warn" : "info"}`}>
                    {tool.kind === "write" ? "Escrita" : "Leitura"}
                  </span>
                </td>
                <td>{tool.desc}</td>
                <td className="mono t12">{tool.cap}</td>
                <td className="mono t12 muted pre">{tool.params.join("\n") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page-note mt-3 pager">
        {session
          ? "Os ids são UUIDs; o console chama o servidor MCP real com o seu acesso."
          : "No servidor os ids são UUIDs; o console usa os ids do Workspace (ex.: prj-pcl, tsk1)."}
      </p>
    </div>
  );
}

const PLACEHOLDER = "// Execute uma ferramenta para ver a resposta JSON";

/** Test console. Mounted with the profile as key: switching profiles clears tool, arguments and response. */
/** MCP tool results carry JSON as text content; show it parsed when it is JSON. */
function readable(response: unknown): unknown {
  if (typeof response !== "object" || response === null) return response;
  const rpc = response as {
    result?: { content?: { type: string; text?: string }[]; isError?: boolean };
    error?: unknown;
  };
  if (rpc.error) return { isError: true, error: rpc.error };
  const content = rpc.result?.content;
  if (!content?.length) return rpc.result ?? response;
  const parsed = content.map((item) => {
    if (item.type !== "text" || item.text === undefined) return item;
    try {
      return JSON.parse(item.text) as unknown;
    } catch {
      return item.text;
    }
  });
  const data = parsed.length === 1 ? parsed[0] : parsed;
  return rpc.result?.isError ? { isError: true, result: data } : data;
}

function Console() {
  const ws = useWorkspace();
  const session = useSession();
  const { db, me } = ws;
  // API mode: examples carry the version the Workspace last read from the service
  const example = (definition: ToolDef | undefined) => {
    const value = definition?.example(ws) ?? {};
    if (session && definition?.name === "update-task-status" && typeof value.taskId === "string")
      return { ...value, version: session.versionOf(value.taskId) ?? 1 };
    return value;
  };
  const [toolName, setToolName] = useState("list-tasks");
  const tool = toolByName(toolName) ?? TOOLS[0];
  const [args, setArgs] = useState(() => JSON.stringify(example(tool), null, 2));
  const [argsError, setArgsError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const roleName = db.roles.find((r) => r.id === me.roleId)?.name ?? me.roleId;

  const run = async () => {
    if (!tool || busy) return;
    let parsed: unknown;
    try {
      parsed = args.trim() ? JSON.parse(args) : {};
    } catch (error) {
      // error position (when the browser reports it) as line/column
      const match = /position (\d+)/.exec(error instanceof Error ? error.message : "");
      let where = "";
      if (match) {
        const before = args.slice(0, Number(match[1])).split("\n");
        where = ` na linha ${before.length}, coluna ${(before.at(-1)?.length ?? 0) + 1}`;
      }
      const message = `JSON inválido${where}: confira aspas duplas, vírgulas e chaves.`;
      setArgsError(message);
      setResult({ isError: true, error: "invalid_json", message });
      return;
    }
    setArgsError(null);
    setBusy(true);
    try {
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        fail("invalid_args", "Os argumentos devem ser um objeto JSON.");
      if (session) {
        const data = readable(await session.callMcp(tool.name, parsed as Args));
        setResult(data);
        // the write went through ms-projects: read the organization again (realtime may lag)
        if (tool.kind === "write") session.reload();
        announce("Ferramenta executada.");
      } else {
        const data = await execute(ws, tool.name, parsed as Args);
        setResult(data);
        announce("Ferramenta executada com sucesso.");
      }
    } catch (error) {
      if (error instanceof ToolError) setResult({ isError: true, error: error.code, message: error.message });
      else if (error instanceof Error)
        setResult({ isError: true, error: "request_failed", message: error.message });
      else throw error;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid c2">
      <div className="panel">
        <div className="panel-head">
          <h2>Console de teste</h2>
        </div>
        <div className="panel-body">
          <Field label="Ferramenta">
            {(props) => (
              <select
                className="select"
                {...props}
                value={toolName}
                onChange={(event) => {
                  const next = toolByName(event.target.value);
                  if (!next) return;
                  setToolName(next.name);
                  setArgs(JSON.stringify(example(next), null, 2));
                  setArgsError(null);
                }}
              >
                {TOOLS.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                    {t.kind === "write" ? "  (escrita)" : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <p className="muted t12">{tool?.desc}</p>
          <Field label="Argumentos (JSON)" error={argsError}>
            <textarea
              className="textarea mono args-in"
              spellCheck={false}
              value={args}
              onChange={(event) => setArgs(event.target.value)}
            />
          </Field>
          {session ? (
            <p className="subtle t12">
              O console chama o servidor MCP (<span className="mono">/mcp</span>) com o seu token de acesso e
              as permissões do seu papel ({roleName}). As de escrita alteram os dados reais da empresa.
            </p>
          ) : (
            <p className="subtle t12">
              O console executa a ferramenta sobre os dados do Workspace, com as permissões do perfil ativo (
              {roleName}). As de escrita alteram os dados e registram auditoria com origem “
              {sourceLabel("mcp")}
              ”. O mcp-server real chama a API do ms-projects com o token do agente.
            </p>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={busy}>
            <Icon name="play" size={14} />
            Executar ferramenta
          </button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h2>Resposta</h2>
        </div>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: long JSON scrolls sideways; the keyboard needs to reach it */}
        {/* biome-ignore lint/a11y/useSemanticElements: the scrollable <pre> keeps its formatting; role only names it */}
        <pre className="code code-out" role="region" tabIndex={0} aria-label="Resposta JSON">
          {result === null ? PLACEHOLDER : JSON.stringify(result, null, 2)}
        </pre>
      </div>
    </div>
  );
}
