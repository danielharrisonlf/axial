<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { actionLabel, entityLabel, FIELD_LABEL } from "../audit";
import { Icon } from "../components/Icon";
import UserAvatar from "../components/UserAvatar.vue";
import { fmtDateTime, LABEL_NAME, PRIO_LABEL, STATUS_META, sourceLabel } from "../lib";
import type {
  InsightAudit,
  InsightProject,
  InsightRoleName,
  InsightSprint,
  InsightTask,
  InsightTeam,
  InsightUser,
} from "../types";

/**
 * Audit record detail (labelled modal dialog). Focus moves into the drawer,
 * Tab stays inside it, Esc closes; the parent returns focus to the row.
 */
const props = defineProps<{
  entry: InsightAudit;
  users: InsightUser[];
  projects: InsightProject[];
  tasks: InsightTask[];
  teams: InsightTeam[];
  sprints: InsightSprint[];
  roles: InsightRoleName[];
  canOpenTask: boolean;
}>();
const emit = defineEmits<{ close: []; openTask: [taskId: string] }>();

const dialog = ref<HTMLElement | null>(null);
const user = computed(() => props.users.find((item) => item.id === props.entry.userId));
const project = computed(() =>
  props.entry.projectId ? props.projects.find((item) => item.id === props.entry.projectId) : undefined,
);
const roleName = computed(() => {
  const roleId = user.value?.roleId;
  return roleId ? (props.roles.find((role) => role.id === roleId)?.name ?? roleId) : "—";
});

type Record_ = Record<string, unknown>;
const asRecord = (value: unknown): Record_ | null =>
  value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record_) : null;
const before = computed(() => asRecord(props.entry.before));
const after = computed(() => asRecord(props.entry.after));
const keys = computed(() => [
  ...new Set([...Object.keys(before.value ?? {}), ...Object.keys(after.value ?? {})]),
]);
/** Task reference instead of the internal id; other entities show only their type. */
const entityRef = computed(() =>
  props.entry.entityType === "task"
    ? (props.tasks.find((task) => task.id === props.entry.entityId)?.ref ?? null)
    : null,
);
const isTask = computed(
  () => props.entry.entityType === "task" && props.tasks.some((task) => task.id === props.entry.entityId),
);

/** Human value of a changed field: names instead of ids, labels instead of keys. */
function fmtVal(key: string, value: unknown): string {
  if (value == null) return "—";
  if ((key === "assigneeId" || key === "leadId") && typeof value === "string")
    return props.users.find((item) => item.id === value)?.name ?? value;
  if (key === "status" && typeof value === "string" && value in STATUS_META)
    return STATUS_META[value as keyof typeof STATUS_META].label;
  if (key === "priority" && typeof value === "string" && value in PRIO_LABEL)
    return PRIO_LABEL[value as keyof typeof PRIO_LABEL];
  if (key === "labels" && Array.isArray(value))
    return value.length ? value.map((item) => LABEL_NAME[String(item)] ?? String(item)).join(", ") : "—";
  if (key === "blockedBy" || key === "teamIds") {
    const ids = Array.isArray(value) ? value.map(String) : [String(value)];
    const names = ids.map((id) =>
      key === "teamIds"
        ? (props.teams.find((team) => team.id === id)?.name ?? id)
        : (props.tasks.find((task) => task.id === id)?.ref ?? id),
    );
    return names.join(", ") || "—";
  }
  if (key === "sprintId" && typeof value === "string")
    return props.sprints.find((sprint) => sprint.id === value)?.name ?? value;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) {
    if (!value.length) return "—";
    // acceptance criteria: "✓ texto" / "○ texto"
    return value
      .map((item) => {
        const rec = asRecord(item);
        return rec && "text" in rec ? `${rec.done ? "✓" : "○"} ${String(rec.text)}` : String(item);
      })
      .join("; ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
    return;
  }
  if (event.key !== "Tab" || !dialog.value) return;
  const items = [...dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const current = document.activeElement;
  if (event.shiftKey && (current === first || current === dialog.value)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && current === last) {
    event.preventDefault();
    first.focus();
  }
}
onMounted(() => dialog.value?.focus());
</script>

<template>
  <div class="backdrop" @click="emit('close')" />
  <aside
    ref="dialog"
    class="drawer"
    role="dialog"
    aria-modal="true"
    aria-label="Registro de auditoria"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <div class="drawer-head">
      <h2 class="drawer-title"><Icon name="scroll" :size="16" /><b>{{ actionLabel(entry.action) }}</b></h2>
      <span class="grow" />
      <button type="button" class="btn btn-ghost btn-icon" aria-label="Fechar" @click="emit('close')">
        <Icon name="x" />
      </button>
    </div>
    <div class="drawer-body">
      <div class="task-props">
        <span class="pl">Usuário</span>
        <span v-if="user" class="who-cell">
          <UserAvatar :user="user" size="sm" />
          <span class="nm">{{ user.name }}</span>
        </span>
        <span v-else class="muted">—</span>
        <span class="pl">Papel</span>
        <span>{{ roleName }}</span>
        <span class="pl">Entidade</span>
        <span>{{ entityLabel(entry.entityType) }}{{ entityRef ? ` · ${entityRef}` : "" }}</span>
        <span class="pl">Projeto</span>
        <a v-if="project" :href="`#/projects/${project.id}`">{{ project.name }}</a>
        <span v-else>—</span>
        <span class="pl">Origem</span>
        <span><span class="src-tag" :class="entry.source">{{ sourceLabel(entry.source) }}</span></span>
        <span class="pl">Data e hora</span>
        <span>{{ fmtDateTime(entry.ts) }}</span>
      </div>

      <div class="section-h">O que aconteceu</div>
      <p>{{ user ? `${user.name} ` : "" }}{{ entry.summary }}.</p>

      <template v-if="keys.length">
        <div class="section-h">Alterações</div>
        <table class="diff-table">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Valor anterior</th>
              <th>Novo valor</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in keys" :key="key">
              <td>{{ FIELD_LABEL[key] ?? key }}</td>
              <td>
                <span v-if="before && key in before" class="diff-old">{{ fmtVal(key, before[key]) }}</span>
                <span v-else class="subtle">—</span>
              </td>
              <td>
                <span v-if="after && key in after" class="diff-new">{{ fmtVal(key, after[key]) }}</span>
                <span v-else class="subtle">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <div v-if="isTask && canOpenTask && entry.entityId" class="mt-3">
        <button type="button" class="btn btn-sm" @click="emit('openTask', entry.entityId)">
          Abrir tarefa<Icon name="arrowR" :size="12" />
        </button>
      </div>
    </div>
  </aside>
</template>
