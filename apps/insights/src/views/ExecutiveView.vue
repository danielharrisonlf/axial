<script setup lang="ts">
import { computed } from "vue";
import BarList from "../components/BarList.vue";
import LineChart from "../components/LineChart.vue";
import {
  isOverdue,
  onTimeRate,
  projectRisk,
  rel,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUSES,
  weeklyCompletions,
} from "../lib";
import type { InsightAudit, InsightProject, InsightTask, InsightTeam, InsightUser } from "../types";

const props = defineProps<{
  projects: InsightProject[];
  tasks: InsightTask[];
  teams: InsightTeam[];
  users: InsightUser[];
  audit: InsightAudit[];
  period: number;
}>();

const completed = computed(() => {
  const cutoff = Date.now() - props.period * 86_400_000;
  return props.tasks.filter((task) => task.status === "done" && new Date(task.updatedAt).getTime() >= cutoff);
});
const late = computed(() => props.tasks.filter(isOverdue));
const atRisk = computed(
  () => props.projects.filter((project) => projectRisk(props.tasks, project).level === "high").length,
);
const rate = computed(() => onTimeRate(props.tasks));

const kpis = computed(() => [
  {
    label: "Projetos ativos",
    value: props.projects.filter((project) => project.status === "active").length,
    context: `${props.projects.length} no recorte`,
  },
  {
    label: "Projetos concluídos",
    value: props.projects.filter((project) => project.status === "done").length,
    context: "entregues",
  },
  {
    label: "Projetos em risco",
    value: atRisk.value,
    context: atRisk.value ? "exigem atenção" : "nenhum",
    tone: atRisk.value ? "bad" : "good",
  },
  {
    label: "Tarefas concluídas",
    value: completed.value.length,
    context: `últimos ${props.period} dias`,
    tone: "good",
  },
  {
    label: "Tarefas atrasadas",
    value: late.value.length,
    context: "em aberto hoje",
    tone: late.value.length ? "bad" : "good",
  },
  {
    label: "Cumprimento de prazos",
    value: rate.value == null ? "—" : `${rate.value}%`,
    context: "entregas no prazo",
    tone: rate.value != null && rate.value < 70 ? "bad" : "good",
  },
]);

const statusItems = computed(() =>
  STATUSES.map((status) => ({
    label: STATUS_LABEL[status],
    value: props.tasks.filter((task) => task.status === status).length,
    color: STATUS_COLOR[status],
  })),
);

const situation = computed(() => {
  const rows = [
    { label: "Saudáveis", value: 0, color: "#1d7a4c" },
    { label: "Atenção", value: 0, color: "#9a5b00" },
    { label: "Em risco", value: 0, color: "#be3030" },
    { label: "Entregues", value: 0, color: "#8b93a1" },
  ];
  for (const project of props.projects) {
    if (project.status === "done") {
      rows[3].value += 1;
      continue;
    }
    const risk = projectRisk(props.tasks, project);
    if (risk.level === "high") rows[2].value += 1;
    else if (risk.level === "mid") rows[1].value += 1;
    else rows[0].value += 1;
  }
  return rows;
});

const teamDeadlines = computed(() => {
  return props.teams
    .map((team) => ({
      teamId: team.id,
      label: team.name,
      value: onTimeRate(props.tasks.filter((task) => task.teamId === team.id)) ?? 0,
      count: props.tasks.filter((task) => task.teamId === team.id && task.status === "done" && task.dueDate)
        .length,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.value - a.value)
    .map((row) => ({ label: row.label, value: row.value, display: `${row.value}%` }));
});

const teamSummary = computed(() =>
  props.teams
    .map((team) => {
      const scoped = props.tasks.filter((task) => task.teamId === team.id);
      const open = scoped.filter((task) => task.status !== "done").length;
      const done = scoped.length - open;
      const lateCount = scoped.filter(isOverdue).length;
      return { team, total: scoped.length, open, done, late: lateCount, rate: onTimeRate(scoped) };
    })
    .filter((row) => row.total > 0),
);

const recent = computed(() =>
  props.audit
    .filter((entry) => entry.action !== "denied")
    .slice(0, 7)
    .map((entry) => ({ ...entry, user: props.users.find((user) => user.id === entry.userId) })),
);
</script>

<template>
  <div class="stat-strip">
    <div v-for="kpi in kpis" :key="kpi.label" class="stat">
      <div class="lbl">{{ kpi.label }}</div>
      <div class="val">{{ kpi.value }}</div>
      <div class="ctx" :class="kpi.tone">{{ kpi.context }}</div>
    </div>
  </div>

  <div class="grid c2">
    <section class="panel">
      <div class="panel-head">
        <h3>Evolução das entregas</h3>
        <span class="spacer" />
        <span class="subtle small">tarefas concluídas por semana</span>
      </div>
      <div class="panel-body">
        <LineChart :points="weeklyCompletions(tasks, period)" unit="concluídas" />
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Tarefas por status</h3></div>
      <div class="panel-body">
        <BarList :items="statusItems" :label-width="130" unit="tarefas" />
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Projetos por situação</h3></div>
      <div class="panel-body">
        <BarList :items="situation" :label-width="120" unit="projetos" />
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h3>Prazos por equipe</h3>
        <span class="spacer" />
        <span class="subtle small">% de entregas no prazo</span>
      </div>
      <div class="panel-body">
        <BarList :items="teamDeadlines" :label-width="130" />
      </div>
    </section>
  </div>

  <div class="grid c2-1" style="margin-top: 14px">
    <section class="panel">
      <div class="panel-head"><h3>Resumo por equipe</h3></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Equipe</th>
              <th class="num">Abertas</th>
              <th class="num">Concluídas</th>
              <th class="num">Atrasadas</th>
              <th class="num">No prazo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in teamSummary" :key="row.team.id">
              <td>{{ row.team.name }}</td>
              <td class="num">{{ row.open }}</td>
              <td class="num">{{ row.done }}</td>
              <td class="num" :class="{ danger: row.late }">{{ row.late }}</td>
              <td class="num">{{ row.rate == null ? "—" : `${row.rate}%` }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h3>Atividades recentes</h3>
      </div>
      <div class="panel-body">
        <div v-for="entry in recent" :key="entry.id" class="hist-item">
          <span class="avatar sm" :style="{ '--av': entry.user?.color ?? '#8b93a1' }">
            {{ entry.user?.initials ?? "?" }}
          </span>
          <span class="grow"><b>{{ entry.user?.name ?? "?" }}</b> {{ entry.summary }}</span>
          <time>{{ rel(entry.ts) }}</time>
        </div>
        <p v-if="!recent.length" class="ins-muted">Sem atividades no recorte.</p>
      </div>
    </section>
  </div>
</template>
