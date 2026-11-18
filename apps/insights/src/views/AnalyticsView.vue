<script setup lang="ts">
import { computed } from "vue";
import BarList, { type BarItem } from "../components/BarList.vue";
import EmptyState from "../components/EmptyState.vue";
import { Icon } from "../components/Icon";
import UserAvatar from "../components/UserAvatar.vue";
import {
  activeBlockers,
  byValueDesc,
  catVar,
  fmtDate,
  isBlocked,
  isOverdue,
  onTimeRate,
  projectProgress,
  projectRisk,
  STATUS_META,
} from "../lib";
import type { InsightProject, InsightSprint, InsightTask, InsightTeam, InsightUser } from "../types";

const props = defineProps<{
  projects: InsightProject[];
  /** Top-level tasks of the filtered projects (and team). */
  tasks: InsightTask[];
  /** Every task in scope (progress, risk and sprints are per project, not per team filter). */
  allTasks: InsightTask[];
  taskById: Map<string, InsightTask>;
  teams: InsightTeam[];
  users: InsightUser[];
  sprints: InsightSprint[];
  openTask?: (taskId: string) => void;
}>();

const blocked = (task: InsightTask) => isBlocked(task, props.taskById);

const comparison = computed(() =>
  props.projects.map((project) => {
    const scoped = props.tasks.filter((task) => task.projectId === project.id);
    const risk = projectRisk(props.allTasks, project, props.taskById);
    return {
      project,
      progress: projectProgress(props.allTasks, project.id),
      total: scoped.length,
      late: scoped.filter(isOverdue).length,
      blocked: scoped.filter(blocked).length,
      rate: onTimeRate(scoped),
      risk,
      tone: risk.level === "high" ? "danger" : risk.level === "mid" ? "warn" : "ok",
      icon:
        risk.level === "high"
          ? ("alert" as const)
          : risk.level === "mid"
            ? ("info" as const)
            : ("check" as const),
    };
  }),
);

const sprintRows = computed(() => {
  const byProject = new Map(props.projects.map((project) => [project.id, project]));
  return props.sprints.flatMap((sprint) => {
    const project = byProject.get(sprint.projectId);
    if (!project) return [];
    const scoped = props.allTasks.filter((task) => task.sprintId === sprint.id && !task.parentId);
    const done = scoped.filter((task) => task.status === "done").length;
    return [
      {
        sprint,
        project,
        total: scoped.length,
        done,
        pct: scoped.length ? Math.round((100 * done) / scoped.length) : 0,
      },
    ];
  });
});

const teamProgress = computed<BarItem[]>(() =>
  props.teams
    .flatMap((team) => {
      const scoped = props.tasks.filter((task) => task.teamId === team.id);
      if (!scoped.length) return [];
      const value = Math.round(
        (100 * scoped.filter((task) => task.status === "done").length) / scoped.length,
      );
      return [{ label: team.name, value, display: `${value}%` }];
    })
    .sort(byValueDesc),
);

const wip = computed(() => props.tasks.filter((task) => task.status === "in_progress"));
const blockedTasks = computed(() => props.tasks.filter(blocked));
const bottlenecks = computed<BarItem[]>(() => [
  {
    label: "Em andamento",
    icon: { status: "in_progress" },
    color: STATUS_META.in_progress.color,
    value: wip.value.length,
  },
  {
    label: "Em revisão",
    icon: { status: "in_review" },
    color: STATUS_META.in_review.color,
    value: props.tasks.filter((task) => task.status === "in_review").length,
  },
  {
    label: "Bloqueadas",
    icon: { icon: "block", color: "var(--warn)" },
    color: "var(--warn)",
    value: blockedTasks.value.length,
  },
]);

const userById = computed(() => new Map(props.users.map((user) => [user.id, user])));
const load = computed(() => {
  const counts = new Map<string, number>();
  for (const task of wip.value)
    if (task.assigneeId) counts.set(task.assigneeId, (counts.get(task.assigneeId) ?? 0) + 1);
  return [...counts]
    .map(([userId, value]) => ({ userId, value }))
    .sort(byValueDesc)
    .slice(0, 4);
});

const dependencies = computed(() =>
  blockedTasks.value.map((task) => ({
    task,
    waits: activeBlockers(task, props.taskById)
      .map((blocker) => `${blocker.ref} (${STATUS_META[blocker.status].label})`)
      .join(", "),
  })),
);
</script>

<template>
  <div class="panel mb">
    <div class="panel-head"><h3>Comparação de projetos</h3></div>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>Projeto</th>
            <th>Progresso</th>
            <th class="num">Tarefas</th>
            <th class="num">Atrasadas</th>
            <th class="num">Bloqueadas</th>
            <th class="num">No prazo</th>
            <th>Data de entrega</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in comparison" :key="row.project.id">
            <td>
              <div class="cell-main">
                <span class="dot lg" aria-hidden="true" :style="{ '--dot': catVar(row.project.color) }" />
                <div>
                  <a :href="`#/projects/${row.project.id}`" class="row-link">{{ row.project.name }}</a>
                  <span class="cell-sub mono">{{ row.project.key }}</span>
                </div>
              </div>
            </td>
            <td>
              <div class="cell-prog">
                <div
                  class="progress"
                  :class="{ ok: row.progress === 100 }"
                  role="progressbar"
                  :aria-valuenow="row.progress"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-valuetext="`${row.progress}%`"
                  :aria-label="`Progresso de ${row.project.name}`"
                >
                  <i :style="{ width: `${row.progress}%` }" />
                </div>
                <span class="pct" aria-hidden="true">{{ row.progress }}%</span>
              </div>
            </td>
            <td class="num">{{ row.total }}</td>
            <td class="num">
              <span v-if="row.late" class="text-danger">{{ row.late }}</span>
              <span v-else class="subtle">0</span>
            </td>
            <td class="num">
              <span v-if="row.blocked" class="text-warn">{{ row.blocked }}</span>
              <span v-else class="subtle">0</span>
            </td>
            <td class="num">{{ row.rate == null ? "—" : `${row.rate}%` }}</td>
            <td class="date">{{ fmtDate(row.project.targetDate) }}</td>
            <td>
              <span class="chip" :class="row.tone"><Icon :name="row.icon" :size="12" />{{ row.risk.label }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="grid c2">
    <div class="panel">
      <div class="panel-head"><h3>Indicadores por sprint</h3></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Sprint</th>
              <th>Status</th>
              <th class="num">Tarefas</th>
              <th class="num">Concluídas</th>
              <th>Conclusão</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in sprintRows" :key="row.sprint.id">
              <td>
                <b>{{ row.sprint.name }}</b>
                <span class="cell-sub">{{ row.project.name }}</span>
              </td>
              <td>
                <span v-if="row.sprint.status === 'active'" class="chip accent">Ativa</span>
                <span v-else-if="row.sprint.status === 'done'" class="chip ok">Concluída</span>
                <span v-else class="chip">Planejada</span>
              </td>
              <td class="num">{{ row.total }}</td>
              <td class="num">{{ row.done }}</td>
              <td>
                <div class="cell-prog">
                  <div
                    class="progress"
                    :class="{ ok: row.pct === 100 }"
                    role="progressbar"
                    :aria-valuenow="row.pct"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-valuetext="`${row.pct}%`"
                    :aria-label="`Conclusão da ${row.sprint.name}`"
                  >
                    <i :style="{ width: `${row.pct}%` }" />
                  </div>
                  <span class="pct" aria-hidden="true">{{ row.pct }}%</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <h3>Progresso por equipe</h3>
        <span class="spacer" />
        <span class="subtle t12">% de tarefas concluídas</span>
      </div>
      <div class="panel-body">
        <BarList :items="teamProgress" label="Progresso por equipe" :label-w="130" />
      </div>
    </div>
  </div>

  <div class="grid c2 mt">
    <div class="panel">
      <div class="panel-head"><h3>Gargalos e carga</h3></div>
      <div class="panel-body">
        <BarList :items="bottlenecks" label="Trabalho em progresso" :label-w="130" unit="tarefas" />
        <template v-if="load.length">
          <div class="section-h">Maior carga em andamento</div>
          <div v-for="row in load" :key="row.userId" class="hist-item">
            <UserAvatar :user="userById.get(row.userId)" size="sm" />
            <span class="grow">{{ userById.get(row.userId)?.name ?? "—" }}</span>
            <span class="num" :class="{ 'text-danger': row.value >= 3 }">{{ row.value }} tarefas</span>
          </div>
        </template>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Tarefas bloqueadas e dependências críticas</h3></div>
      <div class="panel-body">
        <EmptyState
          v-if="!dependencies.length"
          compact
          icon="check"
          title="Nenhum bloqueio ativo"
          msg="Nenhuma tarefa aguarda outra nos filtros atuais."
        />
        <div v-for="row in dependencies" :key="row.task.id" class="hist-item">
          <span :style="{ display: 'inline-flex', color: 'var(--warn)' }"><Icon name="block" :size="14" /></span>
          <span class="grow">
            <a v-if="openTask" href="#" class="mono" @click.prevent="openTask(row.task.id)">{{ row.task.ref }}</a>
            <span v-else class="mono">{{ row.task.ref }}</span>
            {{ ` ${row.task.title}` }}
            <div class="subtle t12">aguarda {{ row.waits }}</div>
          </span>
          <span v-if="isOverdue(row.task)" class="chip danger">Atrasada</span>
        </div>
      </div>
    </div>
  </div>
</template>
