<script setup lang="ts">
import { computed, watch } from "vue";
import ChartTooltip from "./components/ChartTooltip.vue";
import EmptyState from "./components/EmptyState.vue";
import InsFilterBar from "./components/InsFilterBar.vue";
import { bindProfile, provideState, provideTip } from "./state";
import type { InsightsProps, InsightTask } from "./types";
import AnalyticsView from "./views/AnalyticsView.vue";
import AuditView from "./views/AuditView.vue";
import ExecutiveView from "./views/ExecutiveView.vue";

/**
 * Page content of the three Insights screens. The Workspace shell renders the
 * navigation, breadcrumb and brand; this root renders only the page.
 */
const props = defineProps<InsightsProps & { standalone?: boolean }>();
const state = provideState();
provideTip();

// a profile switch clears the filters (prototype: PF.profileHooks)
watch(
  () => props.meId,
  (meId) => bindProfile(state, meId),
  { immediate: true },
);

const isAdmin = computed(() => props.roleId === "admin");
const activeProjects = computed(() => props.projects.filter((project) => !project.archived));
const taskById = computed(() => new Map(props.tasks.map((task) => [task.id, task])));

// values outside the current scope are dropped instead of silently filtering everything out
watch(
  [activeProjects, () => props.teams, isAdmin],
  () => {
    const { ins } = state;
    if (!isAdmin.value) ins.orgId = "";
    if (ins.teamId && !props.teams.some((team) => team.id === ins.teamId)) ins.teamId = "";
    if (ins.projectId && !activeProjects.value.some((project) => project.id === ins.projectId))
      ins.projectId = "";
  },
  { immediate: true },
);

const scope = (ignoreProject: boolean) =>
  activeProjects.value.filter(
    (project) =>
      (!state.ins.orgId || project.orgId === state.ins.orgId) &&
      (ignoreProject || !state.ins.projectId || project.id === state.ins.projectId) &&
      (!state.ins.teamId || project.teamIds.includes(state.ins.teamId)),
  );
const projectOptions = computed(() => scope(true));
const scopedProjects = computed(() => scope(false));
const scopedTasks = computed<InsightTask[]>(() => {
  const ids = new Set(scopedProjects.value.map((project) => project.id));
  return props.tasks.filter(
    (task) =>
      ids.has(task.projectId) && !task.parentId && (!state.ins.teamId || task.teamId === state.ins.teamId),
  );
});
/** Newest first; equal timestamps keep the incoming order (stable sort). */
const auditSorted = computed(() => [...props.audit].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)));
const roleName = computed(() => props.roles.find((role) => role.id === props.roleId)?.name ?? props.roleId);
</script>

<template>
  <div class="ins-root" :class="{ 'ins-standalone': standalone }">
    <template v-if="view === 'audit'">
      <AuditView
        v-if="canAudit"
        :audit="auditSorted"
        :projects="projects"
        :users="users"
        :tasks="tasks"
        :teams="teams"
        :sprints="sprints"
        :roles="roles"
        :open-task="openTask"
      />
      <EmptyState
        v-else
        icon="block"
        title="Acesso restrito"
        :msg="`O perfil “${roleName}” não tem acesso a Central de auditoria. Troque o perfil no canto superior direito para experimentar.`"
      >
        <a class="btn" href="#/dashboard">Voltar ao início</a>
      </EmptyState>
    </template>
    <template v-else>
      <div class="page-head">
        <div v-if="view === 'analytics'">
          <h1 tabindex="-1">Análise de projetos e desempenho</h1>
          <div class="sub">Comparação entre projetos, sprints e equipes, com leitura de gargalos e dependências.</div>
        </div>
        <div v-else>
          <h1 tabindex="-1">Visão executiva</h1>
          <div class="sub">
            Indicadores calculados sobre o estado atual da demonstração — eles reagem às alterações feitas no
            Workspace.
          </div>
        </div>
      </div>
      <InsFilterBar :show-org="isAdmin" :orgs="orgs" :projects="projectOptions" :teams="teams" />
      <AnalyticsView
        v-if="view === 'analytics'"
        :projects="scopedProjects"
        :tasks="scopedTasks"
        :all-tasks="tasks"
        :task-by-id="taskById"
        :teams="teams"
        :users="users"
        :sprints="sprints"
        :open-task="openTask"
      />
      <ExecutiveView
        v-else
        :projects="scopedProjects"
        :tasks="scopedTasks"
        :all-tasks="tasks"
        :task-by-id="taskById"
        :teams="teams"
        :users="users"
        :audit="auditSorted"
        :period="Number(state.ins.period)"
        :can-audit="canAudit"
      />
    </template>
    <ChartTooltip />
  </div>
</template>
