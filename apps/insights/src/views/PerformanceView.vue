<script setup lang="ts">
import { computed } from "vue";
import BarList from "../components/BarList.vue";
import { fmtDate, isOverdue, onTimeRate, projectProgress, projectRisk } from "../lib";
import type { InsightProject, InsightSprint, InsightTask, InsightTeam, InsightUser } from "../types";

const props = defineProps<{
  projects: InsightProject[];
  tasks: InsightTask[];
  teams: InsightTeam[];
  users: InsightUser[];
  sprints: InsightSprint[];
}>();

const comparison = computed(() =>
  props.projects.map((project) => {
    const scoped = props.tasks.filter((task) => task.projectId === project.id && !task.parentId);
    return {
      project,
      progress: projectProgress(props.tasks, project.id),
      total: scoped.length,
      late: scoped.filter(isOverdue).length,
      blocked: scoped.filter((task) => task.blockedBy.length && task.status !== "done").length,
      rate: onTimeRate(scoped),
      risk: projectRisk(props.tasks, project),
    };
  }),
);

const sprintRows = computed(() =>
  props.sprints
    .filter((sprint) => props.projects.some((project) => project.id === sprint.projectId))
    .map((sprint) => {
      const scoped = props.tasks.filter((task) => task.sprintId === sprint.id && !task.parentId);
      const done = scoped.filter((task) => task.status === "done").length;
      return {
        sprint,
        project: props.projects.find((project) => project.id === sprint.projectId),
        total: scoped.length,
        done,
        pct: scoped.length ? Math.round((100 * done) / scoped.length) : 0,
      };
    }),
);

const teamProgress = computed(() =>
  props.teams
    .map((team) => {
      const scoped = props.tasks.filter((task) => task.teamId === team.id);
      return {
        label: team.name,
        value: scoped.length
          ? Math.round((100 * scoped.filter((task) => task.status === "done").length) / scoped.length)
          : 0,
        count: scoped.length,
      };
    })
    .filter((row) => row.count > 0)
    .sort((a, b) => b.value - a.value)
    .map((row) => ({ label: row.label, value: row.value, display: `${row.value}%` })),
);

const wip = computed(() => props.tasks.filter((task) => task.status === "in_progress"));
const review = computed(() => props.tasks.filter((task) => task.status === "in_review"));
const blocked = computed(() =>
  props.tasks
    .filter((task) => task.blockedBy.length && task.status !== "done")
    .map((task) => ({
      task,
      blockers: task.blockedBy
        .map((id) => props.tasks.find((item) => item.id === id))
        .filter((item): item is InsightTask => Boolean(item)),
    }))
    .slice(0, 8),
);

const load = computed(() =>
  Object.entries(
    wip.value.reduce<Record<string, number>>((acc, task) => {
      if (!task.assigneeId) return acc;
      acc[task.assigneeId] = (acc[task.assigneeId] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([userId, count]) => ({
      user: props.users.find((user) => user.id === userId),
      count,
    }))
    .filter((row) => row.user)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4),
);

const projectLabel = (id: string) => props.projects.find((project) => project.id === id)?.name ?? "—";
</script>

<template>
  <section class="panel" style="margin-bottom: 14px">
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
            <th>Entrega</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in comparison" :key="row.project.id">
            <td>
              <b>{{ row.project.name }}</b>
              <div class="mono subtle small">{{ row.project.key }}</div>
            </td>
            <td>
              <div class="progressline">
                <div class="progresstrack"><div class="progressfill" :style="{ width: `${row.progress}%` }" /></div>
                <span class="subtle small">{{ row.progress }}%</span>
              </div>
            </td>
            <td class="num">{{ row.total }}</td>
            <td class="num" :class="{ danger: row.late }">{{ row.late }}</td>
            <td class="num" :class="{ warn: row.blocked }">{{ row.blocked }}</td>
            <td class="num">{{ row.rate == null ? "—" : `${row.rate}%` }}</td>
            <td class="nowrap">{{ fmtDate(row.project.targetDate) }}</td>
            <td><span class="chip" :class="row.risk.level === 'high' ? 'danger' : row.risk.level === 'mid' ? 'warn' : 'ok'">{{ row.risk.label }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <div class="grid c2">
    <section class="panel">
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
                <div class="subtle small">{{ projectLabel(row.sprint.projectId) }}</div>
              </td>
              <td>
                <span class="chip" :class="row.sprint.status === 'active' ? 'accent' : row.sprint.status === 'done' ? 'ok' : ''">
                  {{ row.sprint.status === "active" ? "ativa" : row.sprint.status === "done" ? "concluída" : "planejada" }}
                </span>
              </td>
              <td class="num">{{ row.total }}</td>
              <td class="num">{{ row.done }}</td>
              <td>
                <div class="progressline">
                  <div class="progresstrack"><div class="progressfill" :style="{ width: `${row.pct}%` }" /></div>
                  <span class="subtle small">{{ row.pct }}%</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h3>Progresso por equipe</h3>
        <span class="spacer" />
        <span class="subtle small">% de tarefas concluídas</span>
      </div>
      <div class="panel-body">
        <BarList :items="teamProgress" :label-width="130" />
      </div>
    </section>
  </div>

  <div class="grid c2" style="margin-top: 14px">
    <section class="panel">
      <div class="panel-head"><h3>Gargalos e carga</h3></div>
      <div class="panel-body">
        <BarList
          :items="[
            { label: 'Em andamento', value: wip.length, color: '#2b5fd9' },
            { label: 'Em revisão', value: review.length, color: '#6d4fc4' },
            {
              label: 'Bloqueadas',
              value: tasks.filter((task) => task.blockedBy.length && task.status !== 'done').length,
              color: '#9a5b00',
            },
          ]"
          :label-width="130"
          unit="tarefas"
        />
        <template v-if="load.length">
          <div class="section-h">Maior carga em andamento</div>
          <div v-for="row in load" :key="row.user?.id" class="hist-item">
            <span class="avatar sm" :style="{ '--av': row.user?.color ?? '#8b93a1' }">{{ row.user?.initials }}</span>
            <span class="grow">{{ row.user?.name }}</span>
            <span class="num" :class="{ danger: row.count >= 3 }">{{ row.count }} tarefas</span>
          </div>
        </template>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Tarefas bloqueadas e dependências críticas</h3></div>
      <div class="panel-body">
        <p v-if="!blocked.length" class="ins-muted">Nenhum bloqueio ativo no recorte.</p>
        <div v-for="row in blocked" :key="row.task.id" class="hist-item">
          <span class="warn">⛔</span>
          <span class="grow">
            <span class="mono">{{ row.task.title }}</span>
            <div class="subtle small">
              aguarda
              {{ row.blockers.map((item) => `${item.title} (${item.status})`).join(", ") || "dependência externa" }}
            </div>
          </span>
          <span v-if="isOverdue(row.task)" class="chip danger">atrasada</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.progressline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}
.progresstrack {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--ins-surface-2, #f2f4f7);
  overflow: hidden;
}
.progressfill {
  height: 100%;
  background: var(--ins-ok, #1d7a4c);
}
.small {
  font-size: 11px;
}
.danger {
  color: var(--ins-danger, #be3030);
  font-weight: 600;
}
.warn {
  color: var(--ins-warn, #9a5b00);
}
</style>
