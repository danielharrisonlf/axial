<script setup lang="ts">
import { computed, ref } from "vue";
import type { InsightsProps } from "./types";
import AuditView from "./views/AuditView.vue";
import ExecutiveView from "./views/ExecutiveView.vue";
import PerformanceView from "./views/PerformanceView.vue";

const props = withDefaults(defineProps<InsightsProps>(), { theme: "light" });

const tabs = computed(() => [
  { id: "executive", label: "Dashboard executivo" },
  { id: "performance", label: "Análises de desempenho" },
  ...(props.canAudit ? [{ id: "audit", label: "Central de auditoria" }] : []),
]);
const tab = ref("executive");

const orgId = ref("");
const projectId = ref("");
const teamId = ref("");
const period = ref("90");

const filteredProjects = computed(() =>
  props.projects.filter(
    (project) =>
      !project.archived &&
      (!orgId.value || project.orgId === orgId.value) &&
      (!projectId.value || project.id === projectId.value) &&
      (!teamId.value || project.teamIds.includes(teamId.value)),
  ),
);
const projectIds = computed(() => new Set(filteredProjects.value.map((project) => project.id)));
const filteredTasks = computed(() =>
  props.tasks.filter(
    (task) => projectIds.value.has(task.projectId) && (!teamId.value || task.teamId === teamId.value),
  ),
);
const audit = computed(() => {
  const ids = new Set(props.projects.map((project) => project.id));
  return props.audit.filter(
    (entry) =>
      (!entry.projectId || ids.has(entry.projectId)) &&
      (!projectId.value || entry.projectId === projectId.value) &&
      (!orgId.value ||
        props.projects.find((project) => project.id === entry.projectId)?.orgId === orgId.value),
  );
});
const filtered = computed(() => orgId.value || projectId.value || teamId.value);
const resetFilters = () => {
  orgId.value = "";
  projectId.value = "";
  teamId.value = "";
};
</script>

<template>
  <section class="insights" :data-theme="theme">
    <header class="ins-head">
      <div>
        <h1>ProjectFlow Insights</h1>
        <p>
          Dashboard executivo, análises de desempenho e central de auditoria em um microfrontend
          Vue exibido dentro do Workspace.
        </p>
      </div>
      <span class="ins-badge">Vue 3 · Module Federation</span>
    </header>

    <div class="tabs" role="tablist" aria-label="Áreas do Insights">
      <button
        v-for="item in tabs"
        :key="item.id"
        type="button"
        role="tab"
        :aria-selected="tab === item.id"
        class="tab"
        :class="{ active: tab === item.id }"
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>
    </div>

    <template v-if="tab !== 'audit'">
      <div class="fbar">
        <select v-model="orgId" class="select" aria-label="Organização">
          <option value="">Todas as organizações</option>
          <option v-for="org in orgs" :key="org.id" :value="org.id">{{ org.name }}</option>
        </select>
        <select v-model="projectId" class="select" aria-label="Projeto">
          <option value="">Todos os projetos</option>
          <option v-for="project in filteredProjects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
        <select v-model="teamId" class="select" aria-label="Equipe">
          <option value="">Todas as equipes</option>
          <option v-for="team in teams" :key="team.id" :value="team.id">{{ team.name }}</option>
        </select>
        <select v-model="period" class="select" aria-label="Período">
          <option value="30">Últimos 30 dias</option>
          <option value="60">Últimos 60 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="180">Últimos 180 dias</option>
        </select>
        <button v-if="filtered" type="button" class="btn btn-ghost btn-sm" @click="resetFilters">
          Limpar filtros
        </button>
      </div>
    </template>

    <ExecutiveView
      v-if="tab === 'executive'"
      :projects="filteredProjects"
      :tasks="filteredTasks"
      :teams="teams"
      :users="users"
      :audit="audit"
      :period="Number(period)"
    />
    <PerformanceView
      v-else-if="tab === 'performance'"
      :projects="filteredProjects"
      :tasks="filteredTasks"
      :teams="teams"
      :users="users"
      :sprints="sprints"
    />
    <AuditView v-else :audit="audit" :projects="projects" :users="users" />
  </section>
</template>

<style>
.insights {
  --ins-surface: var(--surface, #fff);
  --ins-surface-2: var(--surface-2, #f2f4f7);
  --ins-border: var(--border, #e5e8ee);
  --ins-ink: var(--ink, #1c2127);
  --ins-ink-2: var(--ink-2, #5b6472);
  --ins-ink-3: var(--ink-3, #8b93a1);
  --ins-accent: var(--accent, #2b5fd9);
  --ins-ok: var(--ok, #1d7a4c);
  --ins-warn: var(--warn, #9a5b00);
  --ins-danger: var(--danger, #be3030);
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--ins-ink);
  font-size: 13px;
}
.insights .ins-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.insights .ins-head h1 {
  margin: 0;
  font-size: 21px;
  letter-spacing: -0.02em;
}
.insights .ins-head p {
  margin: 4px 0 0;
  color: var(--ins-ink-2);
  max-width: 720px;
  line-height: 1.5;
}
.insights .ins-badge {
  flex: none;
  border: 1px solid var(--ins-border);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 11.5px;
  color: var(--ins-ink-2);
  background: var(--ins-surface);
}
.insights .stat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  border: 1px solid var(--ins-border);
  border-radius: 10px;
  background: var(--ins-surface);
}
.insights .stat {
  padding: 12px 16px;
  border-left: 1px solid var(--ins-border);
  min-width: 0;
}
.insights .stat:first-child {
  border-left: 0;
}
.insights .stat .lbl {
  font-size: 11.5px;
  color: var(--ins-ink-2);
}
.insights .stat .val {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
  letter-spacing: -0.01em;
}
.insights .stat .ctx {
  font-size: 11.5px;
  color: var(--ins-ink-3);
  margin-top: 1px;
}
.insights .stat .ctx.bad {
  color: var(--ins-danger);
}
.insights .stat .ctx.good {
  color: var(--ins-ok);
}
.insights .grid {
  display: grid;
  gap: 14px;
}
.insights .grid.c2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.insights .grid.c2-1 {
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
}
.insights .panel {
  border: 1px solid var(--ins-border);
  border-radius: 10px;
  background: var(--ins-surface);
  min-width: 0;
}
.insights .panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ins-border);
}
.insights .panel-head h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.insights .panel-body {
  padding: 14px 16px;
}
.insights .spacer {
  flex: 1;
}
.insights .subtle {
  color: var(--ins-ink-3);
}
.insights .small {
  font-size: 11.5px;
}
.insights .tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.insights .tbl th {
  text-align: left;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ins-ink-3);
  font-weight: 600;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ins-border);
  white-space: nowrap;
}
.insights .tbl td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--ins-border);
  vertical-align: middle;
}
.insights .tbl tbody tr:last-child td {
  border-bottom: 0;
}
.insights .tbl .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.insights .tbl .nowrap {
  white-space: nowrap;
}
.insights .tbl-wrap {
  overflow-x: auto;
}
.insights .chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--ins-border);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 10.5px;
  color: var(--ins-ink-2);
  white-space: nowrap;
}
.insights .chip.ok {
  color: var(--ins-ok);
  border-color: color-mix(in srgb, var(--ins-ok) 35%, transparent);
}
.insights .chip.warn {
  color: var(--ins-warn);
  border-color: color-mix(in srgb, var(--ins-warn) 35%, transparent);
}
.insights .chip.danger {
  color: var(--ins-danger);
  border-color: color-mix(in srgb, var(--ins-danger) 35%, transparent);
}
.insights .chip.accent {
  color: var(--ins-accent);
  border-color: color-mix(in srgb, var(--ins-accent) 35%, transparent);
}
.insights .hist-item {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 7px 0;
  font-size: 12px;
  border-bottom: 1px dashed var(--ins-border);
}
.insights .hist-item:last-child {
  border-bottom: 0;
}
.insights .hist-item time {
  margin-left: auto;
  color: var(--ins-ink-3);
  font-size: 11px;
  white-space: nowrap;
}
.insights .section-h {
  margin: 14px 0 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ins-ink-3);
}
.insights .ins-muted {
  color: var(--ins-ink-3);
  font-size: 11.5px;
}
.insights .fbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
@media (max-width: 900px) {
  .insights .grid.c2,
  .insights .grid.c2-1 {
    grid-template-columns: 1fr;
  }
  .insights .ins-head {
    flex-direction: column;
  }
}
</style>
