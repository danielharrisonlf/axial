<script setup lang="ts">
import { computed } from "vue";

/** Real series only (completions per week); hidden from assistive tech, the KPI text says the value. */
const props = defineProps<{ values: number[] }>();
const W = 88;
const H = 28;
const pad = 3;
const geometry = computed(() => {
  const n = props.values.length;
  const max = Math.max(1, ...props.values);
  const x = (i: number) => pad + (n < 2 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (n - 1));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const line = props.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return {
    line,
    area: `${line} L${x(n - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`,
    cx: x(n - 1).toFixed(1),
    cy: y(props.values[n - 1] ?? 0).toFixed(1),
  };
});
</script>

<template>
  <svg v-if="values.length" class="spark" :viewBox="`0 0 ${W} ${H}`" aria-hidden="true" focusable="false">
    <path class="sp-area" :d="geometry.area" />
    <path class="sp-line" :d="geometry.line" />
    <circle class="sp-dot" r="2.5" :cx="geometry.cx" :cy="geometry.cy" />
  </svg>
</template>
