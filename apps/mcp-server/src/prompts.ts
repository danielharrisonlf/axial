import type { GetPromptResult } from "@modelcontextprotocol/server";
import { HttpException, Inject, Injectable } from "@nestjs/common";
import { type McpContext, Prompt } from "@nestjs/mcp";
import { z } from "zod";
import { day, isOverdue, openBlockers, projectHeader, sprintLine, taskLine, taskList } from "./format.js";
import { CallerIdentity } from "./identity.js";
import { errorText } from "./mcp/errors.filter.js";
import { McpPrimitives } from "./mcp/primitives.js";
import type { Project, Sprint, Summary, Task } from "./schemas.js";
import { SCOPES } from "./scopes.js";
import { AxialApi, type Page } from "./upstream.js";

const read = [SCOPES.projectsRead];
const projectArg = z.uuid().describe("Id do projeto (veja list-projects ou axial://projects)");

const PlanArgs = z.object({
  projectId: projectArg,
  capacidade: z
    .string()
    .regex(/^\d{1,4}$/, "número inteiro de pontos")
    .optional()
    .describe("Capacidade da equipe na sprint, em pontos de estimativa (ex.: 30). Opcional"),
});
const ProjectArgs = z.object({ projectId: projectArg });
const RefineArgs = z.object({ taskId: z.uuid().describe("Id da tarefa a refinar (veja list-tasks)") });
const WeeklyArgs = z.object({
  projectId: projectArg,
  dias: z
    .string()
    .regex(/^\d{1,2}$/, "número de dias")
    .optional()
    .describe("Janela do resumo em dias, de 1 a 31 (padrão 7)"),
});

function prompt(description: string, text: string): GetPromptResult {
  return { description, messages: [{ role: "user", content: { type: "text", text } }] };
}

/** Prompts that embed live Axial data, read with the caller's token, into a ready-to-run request. */
@Injectable()
@McpPrimitives()
export class AxialPrompts {
  constructor(
    @Inject(AxialApi) private readonly api: AxialApi,
    @Inject(CallerIdentity) private readonly identity: CallerIdentity,
  ) {}

  private async projectContext(ctx: McpContext, projectId: string) {
    const [project, summary, sprints] = await Promise.all([
      this.api.get<Project>(ctx, "projects", `/projects/${projectId}`),
      this.api.get<Summary>(ctx, "projects", `/projects/${projectId}/summary`),
      this.api.get<Page<Sprint>>(ctx, "projects", `/projects/${projectId}/sprints`, { pageSize: 100 }),
    ]);
    return { project, summary, sprints: sprints.items };
  }

  @Prompt({
    name: "planejar-sprint",
    title: "Planejar sprint",
    description:
      "Propõe a próxima sprint de um projeto a partir do backlog real (prioridades, prazos, estimativas e dependências) e da capacidade informada.",
    argsSchema: PlanArgs,
    scopes: read,
  })
  async planSprint({ projectId, capacidade }: z.infer<typeof PlanArgs>, ctx: McpContext) {
    const [{ project, summary, sprints }, backlog, all] = await Promise.all([
      this.projectContext(ctx, projectId),
      this.api.collect<Task>(ctx, `/projects/${projectId}/backlog`, {}, 200),
      this.api.collect<Task>(ctx, `/projects/${projectId}/tasks`),
    ]);
    const byId = new Map(all.items.map((task) => [task.id, task]));
    const open = sprints.filter((sprint) => sprint.status !== "done");
    const ordered = [...backlog.items].sort(
      (a, b) =>
        ["urgent", "high", "medium", "low"].indexOf(a.priority) -
          ["urgent", "high", "medium", "low"].indexOf(b.priority) ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
    );
    const text = [
      `Planeje a próxima sprint do projeto ${projectHeader(project)}.`,
      capacidade
        ? `Capacidade da equipe: ${capacidade} pontos.`
        : "Capacidade não informada: proponha um escopo realista e diga a soma de pontos.",
      "",
      `Indicadores: ${summary.done}/${summary.total} tarefas concluídas (${summary.completionPercent}%), ${summary.overdue} atrasadas, ${summary.completedPoints}/${summary.estimatedPoints} pontos.`,
      "",
      "Sprints abertas:",
      open.length ? open.map(sprintLine).join("\n") : "- nenhuma (será preciso criar uma com create-sprint)",
      "",
      `Backlog (${backlog.total} tarefas sem sprint e não concluídas${backlog.truncated ? `, mostrando ${backlog.items.length}` : ""}), por prioridade e prazo:`,
      taskList(ordered, byId),
      "",
      "Proponha: a meta da sprint em uma frase; as tarefas escolhidas (até a capacidade) com o motivo; o que fica de fora; e os riscos.",
      "Priorize urgentes e altas, prazos próximos e o que desbloqueia outras tarefas. Não inclua tarefas bloqueadas por dependências abertas sem dizer como desbloqueá-las. Aponte tarefas sem estimativa.",
      "Só depois de o usuário aprovar: crie a sprint (create-sprint), se não houver uma planejada, e associe as tarefas com assign-tasks-to-sprint.",
    ].join("\n");
    return prompt(`Planejamento da próxima sprint de ${project.key}`, text);
  }

  @Prompt({
    name: "relatorio-de-risco",
    title: "Relatório de risco",
    description:
      "Relatório de risco de um projeto com dados reais: atrasos, bloqueios, trabalho urgente parado, sprint ativa e marcos próximos, com recomendações.",
    argsSchema: ProjectArgs,
    scopes: read,
  })
  async riskReport({ projectId }: z.infer<typeof ProjectArgs>, ctx: McpContext) {
    const [{ project, summary, sprints }, tasks, milestones] = await Promise.all([
      this.projectContext(ctx, projectId),
      this.api.collect<Task>(ctx, `/projects/${projectId}/tasks`),
      this.api.get<Page<{ name: string; date: string; completedAt: string | null }>>(
        ctx,
        "projects",
        `/projects/${projectId}/milestones`,
        { pageSize: 100 },
      ),
    ]);
    const now = Date.now();
    const byId = new Map(tasks.items.map((task) => [task.id, task]));
    const open = tasks.items.filter((task) => task.status !== "done");
    const overdue = open.filter((task) => isOverdue(task, now));
    const blocked = open.filter((task) => openBlockers(task, byId).length > 0);
    const stalled = open.filter(
      (task) => ["urgent", "high"].includes(task.priority) && ["backlog", "todo"].includes(task.status),
    );
    const unassigned = open.filter((task) => task.assigneeId === null);
    const active = sprints.find((sprint) => sprint.status === "active");
    const activeTasks = active ? open.filter((task) => task.sprintId === active.id) : [];
    const horizon = now + 14 * 86_400_000;
    const upcoming = milestones.items.filter(
      (milestone) => !milestone.completedAt && new Date(milestone.date).getTime() <= horizon,
    );
    const text = [
      `Escreva o relatório de risco do projeto ${projectHeader(project)}.`,
      "",
      `Indicadores: ${summary.done}/${summary.total} concluídas (${summary.completionPercent}%), ${summary.overdue} atrasadas, ${summary.completedPoints}/${summary.estimatedPoints} pontos.${tasks.truncated ? ` Atenção: análise sobre as primeiras ${tasks.items.length} de ${tasks.total} tarefas.` : ""}`,
      "",
      active
        ? `Sprint ativa: ${active.name}, termina em ${day(active.endDate)}, ${activeTasks.length} tarefas ainda abertas.`
        : "Nenhuma sprint ativa.",
      "",
      `Atrasadas (${overdue.length}):`,
      taskList(overdue, byId),
      "",
      `Bloqueadas por dependências abertas (${blocked.length}):`,
      taskList(blocked, byId),
      "",
      `Urgentes/altas ainda não iniciadas (${stalled.length}):`,
      taskList(stalled, byId),
      "",
      `Abertas sem responsável: ${unassigned.length}.`,
      "",
      `Marcos não concluídos nos próximos 14 dias ou vencidos (${upcoming.length}):`,
      upcoming.length
        ? upcoming.map((milestone) => `- ${milestone.name} em ${day(milestone.date)}`).join("\n")
        : "- nenhum",
      "",
      "Estruture: (1) nível de risco geral (baixo, médio, alto) com justificativa; (2) principais riscos, cada um com evidência citando as refs; (3) cadeias de bloqueio a resolver primeiro; (4) recomendações concretas com responsável sugerido; (5) o que monitorar na próxima semana.",
      "Não altere dados: este relatório é só leitura.",
    ].join("\n");
    return prompt(`Relatório de risco de ${project.key}`, text);
  }

  @Prompt({
    name: "refinar-tarefa",
    title: "Refinar tarefa",
    description:
      "Refina uma tarefa real: reescreve a descrição, propõe critérios de aceite testáveis, estimativa, subtarefas e riscos, a partir da tarefa, das subtarefas, dos bloqueadores e dos comentários.",
    argsSchema: RefineArgs,
    scopes: read,
  })
  async refineTask({ taskId }: z.infer<typeof RefineArgs>, ctx: McpContext) {
    const task = await this.api.get<Task>(ctx, "projects", `/tasks/${taskId}`);
    const blockerIds = (task.dependencies ?? []).map((dependency) => dependency.dependsOnId).slice(0, 10);
    const [subtasks, comments, blockers] = await Promise.all([
      this.api.get<Page<Task>>(ctx, "projects", `/projects/${task.projectId}/tasks`, {
        parentId: taskId,
        pageSize: 100,
      }),
      this.api.get<Page<{ authorId: string; body: string; createdAt: string }>>(
        ctx,
        "projects",
        `/tasks/${taskId}/comments`,
        { pageSize: 50 },
      ),
      Promise.all(blockerIds.map((id) => this.api.get<Task>(ctx, "projects", `/tasks/${id}`))),
    ]);
    const text = [
      `Refine a tarefa ${task.ref} — "${task.title}" (tipo ${task.type}, status ${task.status}, prioridade ${task.priority}, estimativa ${task.estimate ?? "sem estimativa"}, versão ${task.version}).`,
      "",
      "Descrição atual:",
      task.description.trim() || "(vazia)",
      "",
      "Critérios de aceite atuais:",
      task.acceptanceCriteria.length
        ? task.acceptanceCriteria.map((item) => `- ${item}`).join("\n")
        : "- (nenhum)",
      "",
      `Rótulos: ${task.labels.join(", ") || "nenhum"}. Prazo: ${day(task.dueDate)}.`,
      "",
      `Bloqueadores (${blockers.length}):`,
      blockers.length ? blockers.map((blocker) => taskLine(blocker)).join("\n") : "- nenhum",
      "",
      `Subtarefas (${subtasks.total}):`,
      taskList(subtasks.items),
      "",
      `Comentários (${comments.total}${comments.total > comments.items.length ? `, mostrando ${comments.items.length}` : ""}):`,
      comments.items.length
        ? comments.items
            .map((comment) => `- ${day(comment.createdAt)} @${comment.authorId.slice(0, 8)}: ${comment.body}`)
            .join("\n")
        : "- nenhum",
      "",
      "Proponha: descrição reescrita (objetivo, contexto, fora de escopo); 3 a 7 critérios de aceite verificáveis; estimativa em pontos com justificativa; subtarefas, se a tarefa for grande; dúvidas em aberto e riscos.",
      `Só depois de o usuário aprovar, aplique com update-task (taskId ${task.id}, version ${task.version}); se houver conflito de versão, leia a tarefa de novo antes de tentar outra vez.`,
    ].join("\n");
    return prompt(`Refinamento de ${task.ref}`, text);
  }

  @Prompt({
    name: "resumo-semanal",
    title: "Resumo semanal",
    description:
      "Resumo do período de um projeto com dados reais: entregas, tarefas novas, andamento da sprint ativa e, quando o token tem audit:read, a atividade registrada na auditoria.",
    argsSchema: WeeklyArgs,
    scopes: read,
  })
  async weeklySummary({ projectId, dias }: z.infer<typeof WeeklyArgs>, ctx: McpContext) {
    const days = Math.min(Math.max(Number(dias ?? "7"), 1), 31);
    const since = new Date(Date.now() - days * 86_400_000);
    const identity = await this.identity.resolve(ctx);
    const [{ project, summary, sprints }, tasks] = await Promise.all([
      this.projectContext(ctx, projectId),
      this.api.collect<Task>(ctx, `/projects/${projectId}/tasks`),
    ]);
    const after = (value: string | null) => value !== null && new Date(value) >= since;
    const completed = tasks.items.filter((task) => task.status === "done" && after(task.completedAt));
    const created = tasks.items.filter((task) => after(task.createdAt));
    const moving = tasks.items.filter(
      (task) => task.status !== "done" && after(task.updatedAt) && !after(task.createdAt),
    );
    const active = sprints.find((sprint) => sprint.status === "active");
    const sprintTasks = active ? tasks.items.filter((task) => task.sprintId === active.id) : [];
    let audit: string;
    if (!identity.scopes.includes(SCOPES.auditRead)) {
      audit = "Auditoria não incluída: o token não tem o scope audit:read.";
    } else {
      try {
        const data = await this.api.get<{
          total: number;
          byEventType: Array<{ eventType: string; count: number }>;
          byActor: Array<{ actorId: string; count: number }>;
        }>(ctx, "audit", "/audit/summary", { projectId, from: since.toISOString() });
        audit = [
          `Auditoria do período: ${data.total} eventos.`,
          `Por tipo: ${data.byEventType.map((entry) => `${entry.eventType} ${entry.count}`).join(", ") || "nenhum"}.`,
          `Pessoas mais ativas: ${data.byActor.map((entry) => `@${entry.actorId.slice(0, 8)} ${entry.count}`).join(", ") || "nenhuma"}.`,
        ].join("\n");
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        audit = `Auditoria indisponível neste resumo (${errorText(error)}); diga isso no texto em vez de supor atividade.`;
      }
    }
    const text = [
      `Escreva o resumo dos últimos ${days} dias (desde ${day(since.toISOString())}) do projeto ${projectHeader(project)}.`,
      "",
      `Indicadores atuais: ${summary.done}/${summary.total} concluídas (${summary.completionPercent}%), ${summary.overdue} atrasadas.${tasks.truncated ? ` Análise sobre ${tasks.items.length} de ${tasks.total} tarefas.` : ""}`,
      active
        ? `Sprint ativa: ${active.name} (até ${day(active.endDate)}): ${sprintTasks.filter((task) => task.status === "done").length}/${sprintTasks.length} concluídas.`
        : "Nenhuma sprint ativa.",
      "",
      `Concluídas no período (${completed.length}):`,
      taskList(completed),
      "",
      `Criadas no período (${created.length}):`,
      taskList(created),
      "",
      `Em andamento com alterações no período (${moving.length}):`,
      taskList(moving),
      "",
      audit,
      "",
      "Formato: destaques (3 a 5 itens), entregas, o que avançou, riscos e bloqueios, próximos passos. Use as refs das tarefas. Texto curto, para a equipe e a gestão.",
    ].join("\n");
    return prompt(`Resumo de ${days} dias de ${project.key}`, text);
  }
}
