<script setup lang="ts">
import { computed } from "vue";
import { useState } from "../state";
import type { InsightOrganization, InsightProject, InsightTeam } from "../types";
import FilterSelect from "./FilterSelect.vue";
import { Icon } from "./Icon";

/** Shared Insights filters (Organização only for the administrator, who sees every organization). */
const props = defineProps<{
  showOrg: boolean;
  orgs: InsightOrganization[];
  projects: InsightProject[];
  teams: InsightTeam[];
}>();
const { ins } = useState();

const orgOptions = computed(() => [
  { value: "", label: "Todas" },
  ...props.orgs.map((org) => ({ value: org.id, label: org.name })),
]);
const projectOptions = computed(() => [
  { value: "", label: "Todos" },
  ...props.projects.map((project) => ({ value: project.id, label: project.name })),
]);
const teamOptions = computed(() => [
  { value: "", label: "Todas" },
  ...props.teams.map((team) => ({ value: team.id, label: team.name })),
]);
const periodOptions = [
  { value: "30", label: "Últimos 30 dias" },
  { value: "60", label: "Últimos 60 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "180", label: "Últimos 180 dias" },
];
const orgId = computed({
  get: () => ins.orgId,
  set: (value: string) => {
    ins.orgId = value;
    ins.projectId = "";
  },
});
function clear() {
  ins.orgId = "";
  ins.projectId = "";
  ins.teamId = "";
}
</script>

<template>
  <div class="fbar">
    <FilterSelect v-if="showOrg" v-model="orgId" label="Organização" :options="orgOptions" />
    <FilterSelect v-model="ins.projectId" label="Projeto" :options="projectOptions" />
    <FilterSelect v-model="ins.teamId" label="Equipe" :options="teamOptions" />
    <FilterSelect v-model="ins.period" label="Período" :options="periodOptions" def="90" />
    <button v-if="ins.orgId || ins.projectId || ins.teamId" type="button" class="btn btn-ghost btn-sm" @click="clear">
      <Icon name="x" :size="12" />Limpar
    </button>
  </div>
</template>
