<script setup lang="ts">
import { computed, ref } from "vue";
import { fmtDateTime } from "../lib";
import type { InsightAudit, InsightProject, InsightUser } from "../types";

const props = defineProps<{
  audit: InsightAudit[];
  projects: InsightProject[];
  users: InsightUser[];
}>();

const ACTION_LABEL: Record<string, string> = {
  create: "Criação",
  update: "Atualização",
  status: "Mudança de status",
  priority: "Mudança de prioridade",
  assign: "Atribuição",
  comment: "Comentário",
  block: "Bloqueio",
  archive: "Arquivamento",
  restore: "Restauração",
  delete: "Exclusão",
  sprint_start: "Início de sprint",
  sprint_end: "Encerramento de sprint",
  denied: "Permissão negada",
  retry: "Reenvio",
};
const ENTITY_LABEL: Record<string, string> = {
  task: "Tarefa",
  project: "Projeto",
  sprint: "Sprint",
  epic: "Épico",
  team: "Equipe",
  user: "Usuário",
  notification: "Notificação",
  permission: "Permissão",
};
const FIELD_LABEL: Record<string, string> = {
  status: "Status",
  priority: "Prioridade",
  assigneeId: "Responsável",
  title: "Título",
  name: "Nome",
  desc: "Descrição",
  dueDate: "Vencimento",
  archived: "Arquivado",
  teamIds: "Equipes",
  labels: "Etiquetas",
  role: "Papel",
  active: "Ativo",
  startDate: "Início",
  targetDate: "Entrega",
  key: "Chave",
  leadId: "Responsável",
  sprintId: "Sprint",
  epicId: "Épico",
  channel: "Canal",
  enabled: "Ligado",
  goal: "Meta",
};
const SOURCE_LABEL: Record<string, string> = {
  ui: "interface",
  mcp: "Agente MCP",
  automation: "automação",
  api: "API",
  ai: "IA",
};

const PAGE_SIZE = 20;
const userId = ref("");
const projectId = ref("");
const action = ref("");
const source = ref("");
const entityType = ref("");
const period = ref("30");
const page = ref(0);
const selected = ref<InsightAudit | null>(null);

const actions = computed(() => [...new Set(props.audit.map((entry) => entry.action))].sort());
const entities = computed(() => [...new Set(props.audit.map((entry) => entry.entityType))].sort());

const rows = computed(() => {
  const cutoff = Date.now() - Number(period.value) * 86_400_000;
  return props.audit.filter(
    (entry) =>
      new Date(entry.ts).getTime() >= cutoff &&
      (!userId.value || entry.userId === userId.value) &&
      (!projectId.value || entry.projectId === projectId.value) &&
      (!action.value || entry.action === action.value) &&
      (!source.value || entry.source === source.value) &&
      (!entityType.value || entry.entityType === entityType.value),
  );
});
const pages = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)));
const slice = computed(() => {
  const current = Math.min(page.value, pages.value - 1);
  return rows.value.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
});
const reset = () => {
  userId.value = "";
  projectId.value = "";
  action.value = "";
  source.value = "";
  entityType.value = "";
  page.value = 0;
};
const user = (id: string) => props.users.find((item) => item.id === id);
const project = (id: string | null) => props.projects.find((item) => item.id === id);
const fmtValue = (key: string, value: unknown): string => {
  if (value == null) return "—";
  if (key === "assigneeId") return user(String(value))?.name ?? String(value);
  if (key === "status") return String(value).toUpperCase();
  if (key === "priority") return String(value).toUpperCase();
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};
const diffKeys = (entry: InsightAudit) => {
  const keys = new Set<string>();
  if (entry.before && typeof entry.before === "object")
    for (const key of Object.keys(entry.before as Record<string, unknown>)) keys.add(key);
  if (entry.after && typeof entry.after === "object")
    for (const key of Object.keys(entry.after as Record<string, unknown>)) keys.add(key);
  return [...keys];
};
const hasValue = (record: unknown, key: string) =>
  record != null && typeof record === "object" && key in (record as Record<string, unknown>);
const fieldValue = (record: unknown, key: string) => (record as Record<string, unknown>)[key];
</script>

<template>
  <div class="fbar">
    <select v-model="userId" class="select" aria-label="Usuário" @change="page = 0">
      <option value="">Todos os usuários</option>
      <option v-for="item in users" :key="item.id" :value="item.id">{{ item.name }}</option>
    </select>
    <select v-model="projectId" class="select" aria-label="Projeto" @change="page = 0">
      <option value="">Todos os projetos</option>
      <option v-for="item in projects" :key="item.id" :value="item.id">{{ item.name }}</option>
    </select>
    <select v-model="action" class="select" aria-label="Ação" @change="page = 0">
      <option value="">Todas as ações</option>
      <option v-for="item in actions" :key="item" :value="item">{{ ACTION_LABEL[item] ?? item }}</option>
    </select>
    <select v-model="source" class="select" aria-label="Origem" @change="page = 0">
      <option value="">Todas as origens</option>
      <option value="ui">Interface</option>
      <option value="mcp">Agente MCP</option>
      <option value="automation">Automação</option>
      <option value="api">API</option>
      <option value="ai">IA</option>
    </select>
    <select v-model="entityType" class="select" aria-label="Entidade" @change="page = 0">
      <option value="">Todas as entidades</option>
      <option v-for="item in entities" :key="item" :value="item">{{ ENTITY_LABEL[item] ?? item }}</option>
    </select>
    <select v-model="period" class="select" aria-label="Período" @change="page = 0">
      <option value="7">7 dias</option>
      <option value="30">30 dias</option>
      <option value="90">90 dias</option>
      <option value="365">1 ano</option>
    </select>
    <button
      v-if="userId || projectId || action || source || entityType"
      type="button"
      class="btn btn-ghost btn-sm"
      @click="reset"
    >
      Limpar
    </button>
  </div>

  <div v-if="!rows.length" class="empty">
    <div class="e-ic">▤</div>
    <b>Nenhum registro</b>
    <p>Ajuste os filtros ou realize ações no Workspace.</p>
  </div>
  <section v-else class="panel">
    <div class="tbl-wrap">
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
          <tr v-for="entry in slice" :key="entry.id" class="row-click" @click="selected = entry">
            <td class="nowrap subtle small">{{ fmtDateTime(entry.ts) }}</td>
            <td>
              <span class="who-cell">
                <span class="avatar sm" :style="{ '--av': user(entry.userId)?.color ?? '#8b93a1' }">
                  {{ user(entry.userId)?.initials ?? "?" }}
                </span>
                <span class="nm">{{ user(entry.userId)?.name ?? "—" }}</span>
              </span>
            </td>
            <td>
              <span class="chip" :class="entry.action === 'denied' ? 'danger' : entry.action === 'delete' ? 'warn' : ''">
                {{ ACTION_LABEL[entry.action] ?? entry.action }}
              </span>
            </td>
            <td>{{ ENTITY_LABEL[entry.entityType] ?? entry.entityType }}</td>
            <td>{{ project(entry.projectId)?.name ?? "—" }}</td>
            <td><span class="src-tag" :class="entry.source">{{ SOURCE_LABEL[entry.source] ?? entry.source }}</span></td>
            <td class="summary">{{ entry.summary }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span class="num">{{ rows.length }} registros</span>
      <span class="grow" />
      <button type="button" class="btn btn-sm" :disabled="page <= 0" @click="page -= 1">Anterior</button>
      <span class="num">{{ Math.min(page, pages - 1) + 1 }} / {{ pages }}</span>
      <button type="button" class="btn btn-sm" :disabled="page >= pages - 1" @click="page += 1">Próxima</button>
    </div>
  </section>

  <div v-if="selected" class="drawer-backdrop" @click.self="selected = null">
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Registro de auditoria">
      <header class="drawer-head">
        <b>{{ ACTION_LABEL[selected.action] ?? selected.action }}</b>
        <span class="grow" />
        <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Fechar" @click="selected = null">×</button>
      </header>
      <div class="drawer-body">
        <dl class="props">
          <dt>Usuário</dt>
          <dd>{{ user(selected.userId)?.name ?? "—" }}</dd>
          <dt>Papel</dt>
          <dd>{{ user(selected.userId)?.roleId ?? "—" }}</dd>
          <dt>Entidade</dt>
          <dd>{{ ENTITY_LABEL[selected.entityType] ?? selected.entityType }}{{ selected.entityId ? ` · ${selected.entityId}` : "" }}</dd>
          <dt>Projeto</dt>
          <dd>{{ project(selected.projectId)?.name ?? "—" }}</dd>
          <dt>Origem</dt>
          <dd>{{ SOURCE_LABEL[selected.source] ?? selected.source }}</dd>
          <dt>Data e hora</dt>
          <dd>{{ fmtDateTime(selected.ts) }}</dd>
        </dl>
        <div class="section-h">O que aconteceu</div>
        <p>{{ selected.summary }}.</p>
        <template v-if="selected.before || selected.after">
          <div class="section-h">Alterações</div>
          <table class="tbl diff">
            <thead>
              <tr><th>Campo</th><th>Valor anterior</th><th>Novo valor</th></tr>
            </thead>
            <tbody>
              <tr v-for="key in diffKeys(selected)" :key="key">
                <td>{{ FIELD_LABEL[key] ?? key }}</td>
                <td><span v-if="hasValue(selected.before, key)" class="diff-old">{{ fmtValue(key, fieldValue(selected.before, key)) }}</span><span v-else class="subtle">—</span></td>
                <td><span v-if="hasValue(selected.after, key)" class="diff-new">{{ fmtValue(key, fieldValue(selected.after, key)) }}</span><span v-else class="subtle">—</span></td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.select {
  height: 30px;
  font-size: 12px;
}
.summary {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.small {
  font-size: 11px;
}
.row-click {
  cursor: pointer;
}
.row-click:hover {
  background: var(--ins-surface-2, #f2f4f7);
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px solid var(--ins-border, #e5e8ee);
}
.src-tag {
  font-family: var(--mono, monospace);
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--ins-border, #e5e8ee);
  color: var(--ins-ink-2, #5b6472);
}
.src-tag.mcp {
  color: #6d4fc4;
}
.src-tag.ai {
  color: #2b5fd9;
}
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(12, 16, 22, 0.35);
  z-index: 400;
  display: flex;
  justify-content: flex-end;
}
.drawer {
  width: min(620px, 94vw);
  height: 100%;
  background: var(--ins-surface, #fff);
  color: var(--ins-ink, #1c2127);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 24px rgba(12, 16, 22, 0.18);
}
.drawer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ins-border, #e5e8ee);
}
.drawer-body {
  padding: 16px;
  overflow: auto;
  font-size: 13px;
}
.props {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 6px 12px;
  margin: 0 0 8px;
}
.props dt {
  color: var(--ins-ink-3, #8b93a1);
  font-size: 11.5px;
}
.props dd {
  margin: 0;
  font-size: 12px;
}
.section-h {
  margin: 14px 0 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ins-ink-2, #5b6472);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.diff td {
  font-size: 12px;
}
.diff-old {
  color: var(--ins-danger, #be3030);
  text-decoration: line-through;
}
.diff-new {
  color: var(--ins-ok, #1d7a4c);
  font-weight: 500;
}
.who-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--av, #8b93a1);
  color: #fff;
  font-size: 9px;
  font-weight: 600;
}
</style>
