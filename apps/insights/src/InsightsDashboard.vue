<script setup lang="ts">
import { computed } from "vue";
import type { InsightStatus, InsightsProps } from "./types";

const props = withDefaults(defineProps<InsightsProps>(), {
  theme: "light",
});

const STATUS_ORDER: InsightStatus[] = ["backlog", "todo", "in_progress", "in_review", "done"];
const STATUS_LABEL: Record<InsightStatus, string> = {
  backlog: "Backlog",
  todo: "A fazer",
  in_progress: "Em andamento",
  in_review: "Em revisão",
  done: "Concluído",
};
const STATUS_COLOR: Record<InsightStatus, string> = {
  backlog: "#8b93a1",
  todo: "#5b6472",
  in_progress: "#2b5fd9",
  in_review: "#6d4fc4",
  done: "#1d7a4c",
};

const DAY = 86_400_000;
const now = Date.now();

const realTasks = computed(() => props.tasks.filter((task) => !(task as { parentId?: string }).parentId));

const total = computed(() => realTasks.value.length);
const done = computed(() => realTasks.value.filter((task) => task.status === "done").length);
const late = computed(
  () =>
    realTasks.value.filter(
      (task) =>
        task.status !== "done" &&
        task.dueDate &&
        new Date(`${task.dueDate.slice(0, 10)}T23:59:59`).getTime() < now,
    ).length,
);
const throughput = computed(
  () =>
    realTasks.value.filter(
      (task) => task.status === "done" && now - new Date(task.updatedAt).getTime() <= 30 * DAY,
    ).length,
);
const completionRate = computed(() => (total.value ? Math.round((done.value / total.value) * 100) : 0));
const lateRate = computed(() => (total.value ? Math.round((late.value / total.value) * 100) : 0));
const avgAge = computed(() => {
  const open = realTasks.value.filter((task) => task.status !== "done");
  if (!open.length) return 0;
  return Math.round(
    open.reduce((sum, task) => sum + Math.max(0, now - new Date(task.createdAt).getTime()), 0) /
      open.length /
      DAY,
  );
});

const byStatus = computed(() =>
  STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    color: STATUS_COLOR[status],
    count: realTasks.value.filter((task) => task.status === status).length,
  })),
);

const maxStatus = computed(() => Math.max(1, ...byStatus.value.map((item) => item.count)));

const workload = computed(() => {
  const rows = props.users
    .filter((user) => user.active !== false)
    .map((user) => ({
      id: user.id,
      name: user.name,
      open: realTasks.value.filter((task) => task.assigneeId === user.id && task.status !== "done").length,
      late: realTasks.value.filter(
        (task) =>
          task.assigneeId === user.id &&
          task.status !== "done" &&
          task.dueDate &&
          new Date(`${task.dueDate.slice(0, 10)}T23:59:59`).getTime() < now,
      ).length,
    }))
    .filter((row) => row.open > 0)
    .sort((a, b) => b.open - a.open)
    .slice(0, 8);
  return rows;
});
const maxWorkload = computed(() => Math.max(1, ...workload.value.map((row) => row.open)));

const trend = computed(() => {
  const weeks: { label: string; created: number; done: number }[] = [];
  for (let index = 5; index >= 0; index--) {
    const start = now - (index + 1) * 7 * DAY;
    const end = now - index * 7 * DAY;
    weeks.push({
      label: new Date(end).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      created: realTasks.value.filter((task) => {
        const created = new Date(task.createdAt).getTime();
        return created >= start && created < end;
      }).length,
      done: realTasks.value.filter((task) => {
        const updated = new Date(task.updatedAt).getTime();
        return task.status === "done" && updated >= start && updated < end;
      }).length,
    });
  }
  return weeks;
});
const maxTrend = computed(() => Math.max(1, ...trend.value.flatMap((week) => [week.created, week.done])));

const risks = computed(() =>
  realTasks.value
    .filter(
      (task) =>
        task.status !== "done" &&
        task.dueDate &&
        new Date(`${task.dueDate.slice(0, 10)}T23:59:59`).getTime() < now,
    )
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, 6)
    .map((task) => ({
      ...task,
      project: props.projects.find((project) => project.id === task.projectId)?.name ?? "—",
      daysLate: Math.floor((now - new Date(`${task.dueDate?.slice(0, 10)}T23:59:59`).getTime()) / DAY),
    })),
);

const activeSprints = computed(() => props.sprints.filter((sprint) => sprint.status === "active"));

const projectHealth = computed(() =>
  props.projects.slice(0, 6).map((project) => {
    const tasks = realTasks.value.filter((task) => task.projectId === project.id);
    const projectDone = tasks.filter((task) => task.status === "done").length;
    return {
      ...project,
      progress: tasks.length ? Math.round((projectDone / tasks.length) * 100) : 0,
      open: tasks.length - projectDone,
    };
  }),
);

const kpis = computed(() => [
  { label: "Vazão (30 dias)", value: throughput.value, context: "tarefas concluídas", tone: "good" },
  {
    label: "Conclusão",
    value: `${completionRate.value}%`,
    context: `${done.value} de ${total.value} tarefas`,
    tone: completionRate.value >= 60 ? "good" : "",
  },
  {
    label: "Atrasos",
    value: late.value,
    context: `${lateRate.value}% do trabalho aberto`,
    tone: late.value ? "bad" : "good",
  },
  { label: "Idade média", value: `${avgAge.value}d`, context: "de tarefas em aberto" },
]);
</script>

<template>
  <section class="insights" :data-theme="theme">
    <header class="ins-head">
      <div>
        <h1>Insights de entrega</h1>
        <p>
          Leitura analítica dos projetos visíveis para o seu perfil. Microfrontend Vue carregado pelo
          Workspace via Module Federation.
        </p>
      </div>
      <span class="ins-badge">{{ activeSprints.length }} sprint(s) ativo(s)</span>
    </header>

    <div class="ins-kpis">
      <article v-for="kpi in kpis" :key="kpi.label" class="ins-kpi">
        <div class="ins-kpi-label">{{ kpi.label }}</div>
        <div class="ins-kpi-value">{{ kpi.value }}</div>
        <div class="ins-kpi-context" :class="kpi.tone">{{ kpi.context }}</div>
      </article>
    </div>

    <div class="ins-grid">
      <section class="ins-panel">
        <h2>Distribuição por status</h2>
        <div class="ins-bars-vertical">
          <div v-for="row in byStatus" :key="row.status" class="ins-bar-col">
            <span class="ins-bar-value">{{ row.count }}</span>
            <div class="ins-bar-track">
              <div
                class="ins-bar-fill"
                :style="{ height: `${(row.count / maxStatus) * 100}%`, background: row.color }"
              />
            </div>
            <span class="ins-bar-label">{{ row.label }}</span>
          </div>
        </div>
      </section>

      <section class="ins-panel">
        <h2>Carga por pessoa</h2>
        <p v-if="!workload.length" class="ins-muted">Nenhuma tarefa atribuída no momento.</p>
        <div v-for="row in workload" :key="row.id" class="ins-hbar">
          <span class="ins-hbar-label">{{ row.name }}</span>
          <div class="ins-hbar-track">
            <div class="ins-hbar-fill" :style="{ width: `${(row.open / maxWorkload) * 100}%` }" />
          </div>
          <span class="ins-hbar-value">{{ row.open }}<em v-if="row.late"> · {{ row.late }} atrasada(s)</em></span>
        </div>
      </section>

      <section class="ins-panel ins-wide">
        <h2>Criação vs. conclusão por semana</h2>
        <div class="ins-trend">
          <div v-for="week in trend" :key="week.label" class="ins-trend-col">
            <div class="ins-trend-bars">
              <div
                class="ins-trend-bar created"
                :style="{ height: `${(week.created / maxTrend) * 100}%` }"
                :title="`${week.created} criadas`"
              />
              <div
                class="ins-trend-bar done"
                :style="{ height: `${(week.done / maxTrend) * 100}%` }"
                :title="`${week.done} concluídas`"
              />
            </div>
            <span class="ins-trend-label">{{ week.label }}</span>
          </div>
        </div>
        <div class="ins-legend">
          <span><i class="created" /> Criadas</span>
          <span><i class="done" /> Concluídas</span>
        </div>
      </section>

      <section class="ins-panel">
        <h2>Saúde dos projetos</h2>
        <p v-if="!projectHealth.length" class="ins-muted">Nenhum projeto visível.</p>
        <div v-for="project in projectHealth" :key="project.id" class="ins-project">
          <div class="ins-project-head">
            <span class="ins-project-name">{{ project.name }}</span>
            <span class="ins-project-meta">{{ project.progress }}%</span>
          </div>
          <div class="ins-project-track">
            <div class="ins-project-fill" :style="{ width: `${project.progress}%` }" />
          </div>
          <span class="ins-muted">{{ project.open }} em aberto</span>
        </div>
      </section>

      <section class="ins-panel">
        <h2>Atenção imediata</h2>
        <p v-if="!risks.length" class="ins-muted">Nenhuma tarefa atrasada. Boa cadência.</p>
        <ul v-else class="ins-risks">
          <li v-for="risk in risks" :key="risk.id">
            <span class="ins-risk-title">{{ risk.title }}</span>
            <span class="ins-risk-meta">{{ risk.project }} · {{ risk.daysLate }}d de atraso</span>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.insights {
  --ins-surface: var(--surface, #fff);
  --ins-border: var(--border, #e5e8ee);
  --ins-ink: var(--ink, #1b2230);
  --ins-ink-2: var(--ink-2, #5b6472);
  --ins-ink-3: var(--ink-3, #8b93a1);
  --ins-accent: var(--accent, #2b5fd9);
  --ins-ok: var(--ok, #1d7a4c);
  --ins-danger: var(--danger, #be3030);
  color: var(--ins-ink);
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 13px;
}
.ins-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.ins-head h1 {
  margin: 0;
  font-size: 21px;
  letter-spacing: -0.02em;
}
.ins-head p {
  margin: 4px 0 0;
  color: var(--ins-ink-2);
  max-width: 640px;
  line-height: 1.5;
}
.ins-badge {
  flex: none;
  border: 1px solid var(--ins-border);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 11.5px;
  color: var(--ins-ink-2);
  background: var(--ins-surface);
}
.ins-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}
.ins-kpi {
  border: 1px solid var(--ins-border);
  border-radius: 12px;
  padding: 13px 15px;
  background: var(--ins-surface);
}
.ins-kpi-label {
  font-size: 11.5px;
  color: var(--ins-ink-2);
}
.ins-kpi-value {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  margin-top: 3px;
}
.ins-kpi-context {
  font-size: 11.5px;
  color: var(--ins-ink-3);
  margin-top: 2px;
}
.ins-kpi-context.good {
  color: var(--ins-ok);
}
.ins-kpi-context.bad {
  color: var(--ins-danger);
}
.ins-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.ins-wide {
  grid-column: span 2;
}
.ins-panel {
  border: 1px solid var(--ins-border);
  border-radius: 12px;
  background: var(--ins-surface);
  padding: 15px 16px;
  min-width: 0;
}
.ins-panel h2 {
  margin: 0 0 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ins-ink);
}
.ins-bars-vertical {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  height: 158px;
}
.ins-bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  height: 100%;
  justify-content: flex-end;
  min-width: 0;
}
.ins-bar-value {
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ins-bar-track {
  flex: 1;
  width: 100%;
  max-width: 42px;
  display: flex;
  align-items: flex-end;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ins-border) 45%, transparent);
}
.ins-bar-fill {
  width: 100%;
  border-radius: 6px;
  min-height: 2px;
  transition: height 0.4s ease;
}
.ins-bar-label {
  font-size: 10.5px;
  color: var(--ins-ink-3);
  text-align: center;
  white-space: nowrap;
}
.ins-hbar {
  display: grid;
  grid-template-columns: 110px 1fr auto;
  align-items: center;
  gap: 9px;
  padding: 4px 0;
}
.ins-hbar-label {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ins-hbar-track {
  height: 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ins-border) 55%, transparent);
  overflow: hidden;
}
.ins-hbar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--ins-accent);
}
.ins-hbar-value {
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--ins-ink-2);
  white-space: nowrap;
}
.ins-hbar-value em {
  color: var(--ins-danger);
  font-style: normal;
}
.ins-trend {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  height: 150px;
}
.ins-trend-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  height: 100%;
  justify-content: flex-end;
}
.ins-trend-bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  width: 100%;
}
.ins-trend-bar {
  width: 14px;
  border-radius: 4px 4px 0 0;
  min-height: 2px;
  transition: height 0.4s ease;
}
.ins-trend-bar.created,
.ins-legend i.created {
  background: color-mix(in srgb, var(--ins-accent) 55%, transparent);
}
.ins-trend-bar.done,
.ins-legend i.done {
  background: var(--ins-ok);
}
.ins-trend-label {
  font-size: 10.5px;
  color: var(--ins-ink-3);
}
.ins-legend {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--ins-ink-2);
}
.ins-legend i {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  margin-right: 5px;
}
.ins-project {
  padding: 6px 0;
}
.ins-project-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.ins-project-name {
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ins-project-meta {
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--ins-ink-2);
}
.ins-project-track {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ins-border) 55%, transparent);
  overflow: hidden;
  margin: 5px 0 3px;
}
.ins-project-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--ins-ok);
}
.ins-risks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.ins-risks li {
  border-left: 3px solid var(--ins-danger);
  padding-left: 9px;
  display: flex;
  flex-direction: column;
}
.ins-risk-title {
  font-size: 12px;
  font-weight: 500;
}
.ins-risk-meta {
  font-size: 11px;
  color: var(--ins-ink-3);
}
.ins-muted {
  color: var(--ins-ink-3);
  font-size: 11.5px;
}
@media (max-width: 860px) {
  .ins-grid {
    grid-template-columns: 1fr;
  }
  .ins-wide {
    grid-column: span 1;
  }
  .ins-head {
    flex-direction: column;
  }
}
</style>
