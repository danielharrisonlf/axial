<script setup lang="ts">
import { computed } from "vue";
import BarList, { type BarItem } from "../components/BarList.vue";
import EmptyState from "../components/EmptyState.vue";
import { Icon, type IconName } from "../components/Icon";
import KpiSparkline from "../components/KpiSparkline.vue";
import LineChart from "../components/LineChart.vue";
import UserAvatar from "../components/UserAvatar.vue";
import {
  byValueDesc,
  DAY,
  doneAtTime,
  isOverdue,
  onTimeRate,
  plural,
  projectRisk,
  rel,
  STATUS_META,
  STATUSES,
  weeklyCompletions,
} from "../lib";
import type { InsightAudit, InsightProject, InsightTask, InsightTeam, InsightUser } from "../types";

const props = defineProps<{
  projects: InsightProject[];
  /** Top-level tasks of the filtered projects (and team). */
  tasks: InsightTask[];
  /** Every task in scope: risk is computed per project, independent of the team filter. */
  allTasks: InsightTask[];
  taskById: Map<string, InsightTask>;
  teams: InsightTeam[];
  users: InsightUser[];
  audit: InsightAudit[];
  period: number;
  canAudit: boolean;
}>();

const risk = (project: InsightProject) => projectRisk(props.allTasks, project, props.taskById);

const buckets = computed(() => weeklyCompletions(props.tasks, props.period));
const completed = computed(() => {
  const cutoff = Date.now() - props.period * DAY;
  return props.tasks.filter((task) => doneAtTime(task) >= cutoff).length;
});
const late = computed(() => props.tasks.filter(isOverdue).length);
const rate = computed(() => onTimeRate(props.tasks));
const atRisk = computed(
  () =>
    props.projects.filter((project) => project.status === "active" && risk(project).level === "high").length,
);

interface Kpi {
  icon: IconName;
  label: string;
  value: string;
  ctx: string;
  tone?: "bad" | "good";
  spark?: number[];
}
const kpis = computed<Kpi[]>(() => [
  {
    icon: "folders",
    label: "Projetos ativos",
    value: String(props.projects.filter((project) => project.status === "active").length),
    ctx: plural(props.projects.length, "projeto nos filtros", "projetos nos filtros"),
  },
  {
    icon: "flag",
    label: "Projetos concluídos",
    value: String(props.projects.filter((project) => project.status === "done").length),
    ctx: "entregues",
  },
  {
    icon: "alert",
    label: "Projetos em risco",
    value: String(atRisk.value),
    ctx: atRisk.value ? "exigem atenção" : "nenhum",
    tone: atRisk.value ? "bad" : "good",
  },
  {
    icon: "check2",
    label: "Tarefas concluídas",
    value: String(completed.value),
    ctx: `últimos ${props.period} dias`,
    spark: buckets.value.map((bucket) => bucket.y),
  },
  {
    icon: "clock",
    label: "Tarefas atrasadas",
    value: String(late.value),
    ctx: "em aberto hoje",
    tone: late.value ? "bad" : "good",
  },
  {
    icon: "target",
    label: "Cumprimento de prazos",
    value: rate.value == null ? "—" : `${rate.value}%`,
    ctx: "tarefas concluídas no prazo",
    tone: rate.value != null && rate.value < 70 ? "bad" : undefined,
  },
]);

const total = computed(() => buckets.value.reduce((sum, bucket) => sum + bucket.y, 0));
const chartHead = computed(() => {
  const weeks = buckets.value.length;
  const avg = (total.value / weeks).toFixed(1).replace(".", ",");
  return `tarefas concluídas em ${weeks} semanas · média ${avg}/semana`;
});
const chartLabel = computed(
  () =>
    `Tarefas concluídas por semana: ${buckets.value.map((bucket) => `${bucket.label} ${bucket.y}`).join(", ")}`,
);

// status distribution: status color, always with glyph + label (never color alone)
const statusItems = computed<BarItem[]>(() =>
  STATUSES.map((status) => ({
    label: STATUS_META[status].label,
    icon: { status },
    color: STATUS_META[status].color,
    value: props.tasks.filter((task) => task.status === status).length,
  })),
);

const situation = computed<BarItem[]>(() => {
  const counts = { ok: 0, mid: 0, high: 0, done: 0 };
  for (const project of props.projects) {
    if (project.status === "done") counts.done += 1;
    else counts[risk(project).level] += 1;
  }
  return [
    { label: "Saudáveis", icon: { icon: "check", color: "var(--ok)" }, color: "var(--ok)", value: counts.ok },
    {
      label: "Atenção",
      icon: { icon: "info", color: "var(--warn)" },
      color: "var(--warn)",
      value: counts.mid,
    },
    {
      label: "Em risco",
      icon: { icon: "alert", color: "var(--danger)" },
      color: "var(--danger)",
      value: counts.high,
    },
    {
      label: "Entregues",
      icon: { icon: "flag", color: "var(--ink-3)" },
      color: "var(--ink-3)",
      value: counts.done,
    },
  ];
});

const teamTasks = (teamId: string) => props.tasks.filter((task) => task.teamId === teamId);

// below 70% on time the bar turns to warning (the value is written next to it)
const deadlines = computed<BarItem[]>(() =>
  props.teams
    .flatMap((team) => {
      const value = onTimeRate(teamTasks(team.id));
      return value == null
        ? []
        : [{ label: team.name, value, display: `${value}%`, color: value < 70 ? "var(--warn)" : undefined }];
    })
    .sort(byValueDesc),
);

const summary = computed(() =>
  props.teams.flatMap((team) => {
    const scoped = teamTasks(team.id);
    if (!scoped.length) return [];
    const open = scoped.filter((task) => task.status !== "done").length;
    return [
      {
        team,
        open,
        done: scoped.length - open,
        late: scoped.filter(isOverdue).length,
        rate: onTimeRate(scoped),
      },
    ];
  }),
);

const userById = computed(() => new Map(props.users.map((user) => [user.id, user])));
const recent = computed(() => {
  const ids = new Set(props.projects.map((project) => project.id));
  return props.audit
    .filter((entry) => entry.action !== "denied" && (!entry.projectId || ids.has(entry.projectId)))
    .slice(0, 7);
});
</script>

<template>
  <div class="stat-strip">
    <div v-for="kpi in kpis" :key="kpi.label" class="stat">
      <div class="lbl"><Icon :name="kpi.icon" :size="14" />{{ kpi.label }}</div>
      <div class="stat-row">
        <div class="val">{{ kpi.value }}</div>
        <KpiSparkline v-if="kpi.spark" :values="kpi.spark" />
      </div>
      <div class="ctx" :class="kpi.tone">{{ kpi.ctx }}</div>
    </div>
  </div>

  <div class="grid c2">
    <div class="panel">
      <div class="panel-head">
        <h3>Evolução das conclusões</h3>
        <span class="spacer" />
        <span class="subtle t12">por semana</span>
      </div>
      <div class="panel-body">
        <div class="chart-head">
          <span class="big">{{ total }}</span>
          <span class="muted">{{ chartHead }}</span>
        </div>
        <LineChart :points="buckets" :label="chartLabel" unit="concluídas" />
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Tarefas por status</h3></div>
      <div class="panel-body">
        <BarList :items="statusItems" label="Distribuição de tarefas por status" :label-w="130" unit="tarefas" />
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Projetos por situação</h3></div>
      <div class="panel-body">
        <BarList :items="situation" label="Projetos por situação" :label-w="120" unit="projetos" />
      </div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <h3>Prazos por equipe</h3>
        <span class="spacer" />
        <span class="subtle t12">% de tarefas concluídas no prazo</span>
      </div>
      <div class="panel-body">
        <BarList v-if="deadlines.length" :items="deadlines" label="Cumprimento de prazos por equipe" :label-w="130" />
        <EmptyState
          v-else
          compact
          icon="calendar"
          title="Sem tarefas concluídas com prazo"
          msg="Conclua tarefas com prazo definido para medir o cumprimento."
        />
      </div>
    </div>
  </div>

  <div class="grid c2-1 mt">
    <div class="panel">
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
            <tr v-for="row in summary" :key="row.team.id">
              <td>{{ row.team.name }}</td>
              <td class="num">{{ row.open }}</td>
              <td class="num">{{ row.done }}</td>
              <td class="num">
                <span v-if="row.late" class="text-danger">{{ row.late }}</span>
                <span v-else class="subtle">0</span>
              </td>
              <td class="num">{{ row.rate == null ? "—" : `${row.rate}%` }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <h3>Atividades recentes</h3>
        <span class="spacer" />
        <a v-if="canAudit" class="btn btn-ghost btn-sm" href="#/insights/audit">Auditoria<Icon name="arrowR" :size="12" /></a>
      </div>
      <div class="panel-body">
        <div v-if="recent.length" class="timeline">
          <div v-for="entry in recent" :key="entry.id" class="hist-item">
            <UserAvatar :user="userById.get(entry.userId)" size="sm" />
            <span class="tl-txt"><b>{{ userById.get(entry.userId)?.name ?? "?" }}</b> {{ entry.summary }}</span>
            <time :datetime="entry.ts">{{ rel(entry.ts) }}</time>
          </div>
        </div>
        <EmptyState
          v-else
          compact
          icon="pulse"
          title="Sem atividade nos filtros"
          msg="Ajuste os filtros para ver as ações recentes."
        />
      </div>
    </div>
  </div>
</template>
