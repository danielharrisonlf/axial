<script setup lang="ts">
import { computed } from "vue";
import { useTip } from "../state";
import type { InsightStatus } from "../types";
import { Icon, type IconName } from "./Icon";
import StatusIcon from "./StatusIcon.vue";

/** Leading glyph of a row: a status ring or a tinted icon (never color alone). */
export type BarIcon = { status: InsightStatus } | { icon: IconName; color: string };
export interface BarItem {
  label: string;
  value: number;
  display?: string;
  /** Token reference (var(--…)); the value is always written as text too. */
  color?: string;
  icon?: BarIcon;
}

/** Horizontal bars (HTML): label + glyph on the left, value as text on the right. */
const props = defineProps<{ items: BarItem[]; label: string; labelW?: number; unit?: string }>();
const tip = useTip();
const max = computed(() => Math.max(1, ...props.items.map((item) => item.value)));
const summary = computed(
  () =>
    `${props.label}: ${props.items.map((item) => `${item.label} ${item.display ?? item.value}`).join(", ")}`,
);
const shown = (item: BarItem) => item.display ?? String(item.value);
function move(event: MouseEvent, item: BarItem) {
  tip.show(event.clientX, event.clientY - 4, [
    item.label,
    `${shown(item)}${props.unit ? ` ${props.unit}` : ""}`,
  ]);
}
</script>

<template>
  <div class="bar-list" role="img" :aria-label="summary" :style="labelW ? { '--bar-lw': `${labelW}px` } : undefined">
    <div v-for="item in items" :key="item.label" class="bar-row" @mousemove="move($event, item)" @mouseleave="tip.hide()">
      <span class="bar-label">
        <template v-if="item.icon">
          <StatusIcon v-if="'status' in item.icon" :status="item.icon.status" :size="13" />
          <span v-else :style="{ display: 'inline-flex', color: item.icon.color }"><Icon :name="item.icon.icon" :size="14" /></span>
        </template>
        <span>{{ item.label }}</span>
      </span>
      <span class="bar-track"><i :style="{ width: `${Math.round((100 * item.value) / max)}%`, '--bar': item.color }" /></span>
      <span class="bar-value">{{ shown(item) }}</span>
    </div>
  </div>
</template>
