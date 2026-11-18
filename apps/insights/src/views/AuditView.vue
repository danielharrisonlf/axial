<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ACTION_LABEL, actionLabel, ENTITY_LABEL, entityLabel } from "../audit";
import EmptyState from "../components/EmptyState.vue";
import FilterSelect from "../components/FilterSelect.vue";
import { Icon } from "../components/Icon";
import UserAvatar from "../components/UserAvatar.vue";
import { DAY, fmtDateTime, plural, SOURCE_LABEL, sourceLabel } from "../lib";
import { useState } from "../state";
import type {
  InsightAudit,
  InsightProject,
  InsightRoleName,
  InsightSprint,
  InsightTask,
  InsightTeam,
  InsightUser,
} from "../types";
import AuditDrawer from "./AuditDrawer.vue";

const props = defineProps<{
  /** Newest first, already scoped by the host. */
  audit: InsightAudit[];
  projects: InsightProject[];
  users: InsightUser[];
  tasks: InsightTask[];
  teams: InsightTeam[];
  sprints: InsightSprint[];
  roles: InsightRoleName[];
  openTask?: (taskId: string) => void;
}>();

const PAGE = 20;
const { aud } = useState();
const table = ref<HTMLElement | null>(null);
const selectedId = ref<string | null>(null);

const userById = computed(() => new Map(props.users.map((user) => [user.id, user])));
const projectById = computed(() => new Map(props.projects.map((project) => [project.id, project])));

// values outside the current scope are dropped instead of hiding every record
watch(
  [() => props.users, () => props.projects],
  () => {
    if (aud.userId && !userById.value.has(aud.userId)) aud.userId = "";
    if (aud.projectId && !projectById.value.has(aud.projectId)) aud.projectId = "";
  },
  { immediate: true },
);

const userOptions = computed(() => [
  { value: "", label: "Todos" },
  ...props.users.map((user) => ({ value: user.id, label: user.name })),
]);
const projectOptions = computed(() => [
  { value: "", label: "Todos" },
  ...props.projects.map((project) => ({
    value: project.id,
    label: project.name + (project.archived ? " (arquivado)" : ""),
  })),
]);
// options come from the records in scope, in the label order: none that can never match
const present = (key: "action" | "source" | "entityType", labels: Record<string, string>) => {
  const seen = new Set(props.audit.map((entry) => entry[key]));
  return [
    { value: "", label: "Todas" },
    ...Object.entries(labels)
      .filter(([value]) => seen.has(value))
      .map(([value, label]) => ({ value, label })),
    ...[...seen].filter((value) => !(value in labels)).map((value) => ({ value, label: value })),
  ];
};
const actionOptions = computed(() => present("action", ACTION_LABEL));
const sourceOptions = computed(() => present("source", SOURCE_LABEL));
const entityOptions = computed(() => present("entityType", ENTITY_LABEL));
const taskRef = computed(() => new Map(props.tasks.map((task) => [task.id, task.ref])));
/** "Tarefa · PCL-110": the reference the presenter just saw on the Kanban. */
const entityText = (entry: InsightAudit) => {
  const ref = entry.entityType === "task" && entry.entityId ? taskRef.value.get(entry.entityId) : undefined;
  return ref ? `${entityLabel(entry.entityType)} · ${ref}` : entityLabel(entry.entityType);
};
const periodOptions = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "365", label: "1 ano" },
];

// any filter change goes back to the first page
watch(
  () => [aud.userId, aud.projectId, aud.action, aud.source, aud.entityType, aud.period, aud.q],
  () => {
    aud.page = 0;
  },
);
const filtered = computed(
  () => aud.userId || aud.projectId || aud.action || aud.source || aud.entityType || aud.q,
);
function clear() {
  aud.q = "";
  aud.userId = "";
  aud.projectId = "";
  aud.action = "";
  aud.source = "";
  aud.entityType = "";
}

const rows = computed(() => {
  const cutoff = Date.now() - Number(aud.period) * DAY;
  const q = aud.q.trim().toLowerCase();
  return props.audit.filter(
    (entry) =>
      new Date(entry.ts).getTime() >= cutoff &&
      (!q || `${entityText(entry)} ${entry.summary}`.toLowerCase().includes(q)) &&
      (!aud.userId || entry.userId === aud.userId) &&
      (!aud.projectId || entry.projectId === aud.projectId) &&
      (!aud.action || entry.action === aud.action) &&
      (!aud.source || entry.source === aud.source) &&
      (!aud.entityType || entry.entityType === aud.entityType),
  );
});
const pages = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE)));
const page = computed(() => Math.min(aud.page, pages.value - 1));
const slice = computed(() => rows.value.slice(page.value * PAGE, page.value * PAGE + PAGE));
const selected = computed(() => props.audit.find((entry) => entry.id === selectedId.value) ?? null);

function chipTone(action: string): string {
  return action === "denied" ? "danger" : action === "delete" ? "warn" : "";
}

/** Closing the drawer returns focus to the row that opened it. */
async function close() {
  const id = selectedId.value;
  selectedId.value = null;
  await nextTick();
  const trigger = id ? table.value?.querySelector<HTMLElement>(`[data-audit-id="${CSS.escape(id)}"]`) : null;
  trigger?.focus();
}
function openTaskFromDrawer(taskId: string) {
  selectedId.value = null;
  props.openTask?.(taskId);
}
</script>

<template>
  <div class="page-head">
    <div>
      <h1 tabindex="-1">Central de auditoria</h1>
      <div class="sub">
        Trilha completa das ações: quem fez, o quê, em qual entidade, com valores anteriores e novos, e a origem
        (interface, agente MCP, automação ou API).
      </div>
    </div>
  </div>

  <div class="fbar">
    <input
      v-model="aud.q"
      class="input search"
      type="search"
      placeholder="Buscar por referência ou texto…"
      aria-label="Buscar na auditoria"
    />
    <FilterSelect v-model="aud.userId" label="Usuário" :options="userOptions" />
    <FilterSelect v-model="aud.projectId" label="Projeto" :options="projectOptions" />
    <FilterSelect v-model="aud.action" label="Ação" :options="actionOptions" />
    <FilterSelect v-model="aud.source" label="Origem" :options="sourceOptions" />
    <FilterSelect v-model="aud.entityType" label="Entidade" :options="entityOptions" />
    <FilterSelect v-model="aud.period" label="Período" :options="periodOptions" def="90" />
    <button v-if="filtered" type="button" class="btn btn-ghost btn-sm" @click="clear">
      <Icon name="x" :size="12" />Limpar
    </button>
  </div>

  <EmptyState
    v-if="!rows.length"
    icon="scroll"
    title="Nenhum registro"
    msg="Ajuste os filtros ou realize ações no Workspace."
  />
  <div v-else class="panel">
    <div ref="table" class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>Quando</th>
            <th>Usuário</th>
            <th>Ação</th>
            <th>Entidade</th>
            <th>Projeto</th>
            <th>Origem</th>
            <th>Resumo</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in slice" :key="entry.id" class="row-click" :class="{ 'is-selected': selectedId === entry.id }">
            <td class="nowrap muted t12">{{ fmtDateTime(entry.ts) }}</td>
            <td>
              <span v-if="userById.get(entry.userId)" class="who-cell">
                <UserAvatar :user="userById.get(entry.userId)" size="sm" />
                <span class="nm">{{ userById.get(entry.userId)?.name }}</span>
              </span>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span class="chip" :class="chipTone(entry.action)">{{ actionLabel(entry.action) }}</span>
            </td>
            <td class="nowrap">{{ entityText(entry) }}</td>
            <td>{{ (entry.projectId && projectById.get(entry.projectId)?.name) || "—" }}</td>
            <td>
              <span class="src-tag" :class="entry.source">{{ sourceLabel(entry.source) }}</span>
            </td>
            <td class="cell-trunc">
              <button
                type="button"
                class="row-link"
                :title="entry.summary"
                :data-audit-id="entry.id"
                aria-haspopup="dialog"
                @click="selectedId = entry.id"
              >
                {{ entry.summary }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span class="num">{{ plural(rows.length, "registro", "registros") }}</span>
      <span class="grow" />
      <button type="button" class="btn btn-sm" :disabled="page === 0" @click="aud.page = page - 1">
        <Icon name="chevL" :size="12" />Anterior
      </button>
      <span class="num">{{ page + 1 }} / {{ pages }}</span>
      <button type="button" class="btn btn-sm" :disabled="page >= pages - 1" @click="aud.page = page + 1">
        Próxima<Icon name="chevR" :size="12" />
      </button>
    </div>
  </div>

  <AuditDrawer
    v-if="selected"
    :entry="selected"
    :users="users"
    :projects="projects"
    :tasks="tasks"
    :teams="teams"
    :sprints="sprints"
    :roles="roles"
    :can-open-task="!!openTask"
    @close="close"
    @open-task="openTaskFromDrawer"
  />
</template>
