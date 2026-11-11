<script setup lang="ts">
import { computed } from "vue";

interface BarItem {
  label: string;
  value: number;
  color?: string;
  display?: string;
}

const props = withDefaults(
  defineProps<{ items: BarItem[]; labelWidth?: number; unit?: string; emptyText?: string }>(),
  { labelWidth: 140, unit: "itens", emptyText: "Sem dados no recorte." },
);
const max = computed(() => Math.max(1, ...props.items.map((item) => item.value)));
</script>

<template>
  <div class="barlist" role="img" :aria-label="`Distribuição em ${unit}`">
    <p v-if="!items.length" class="ins-muted">{{ emptyText }}</p>
    <div v-for="item in items" :key="item.label" class="barrow">
      <span class="barlabel" :style="{ width: `${labelWidth}px` }">{{ item.label }}</span>
      <div class="bartrack">
        <div
          class="barfill"
          :style="{
            width: `${Math.round((item.value / max) * 100)}%`,
            background: item.color ?? 'var(--ins-accent, #2b5fd9)',
          }"
        />
      </div>
      <span class="barvalue">{{ item.display ?? item.value }}</span>
    </div>
  </div>
</template>

<style scoped>
.barrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
}
.barlabel {
  flex: none;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ins-ink-2, #5b6472);
}
.bartrack {
  flex: 1;
  height: 13px;
  border-radius: 4px;
  border: 1px solid var(--ins-border, #e5e8ee);
  background: var(--ins-surface-2, #f2f4f7);
  overflow: hidden;
}
.barfill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}
.barvalue {
  flex: none;
  width: 56px;
  text-align: right;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ins-muted {
  color: var(--ins-ink-3, #8b93a1);
  font-size: 11.5px;
}
</style>
