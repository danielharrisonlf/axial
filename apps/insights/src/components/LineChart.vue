<script setup lang="ts">
const props = defineProps<{ points: { label: string; value: number }[]; unit?: string }>();
const W = 640;
const H = 200;
const padL = 34;
const padR = 10;
const padT = 14;
const padB = 24;
const maxY = Math.max(4, ...props.points.map((point) => point.value));
const innerW = W - padL - padR;
const innerH = H - padT - padB;
const px = (index: number) =>
  padL + (props.points.length < 2 ? innerW / 2 : (index * innerW) / (props.points.length - 1));
const py = (value: number) => padT + innerH - (value / maxY) * innerH;
const line = props.points
  .map((point, index) => `${index ? "L" : "M"}${px(index).toFixed(1)} ${py(point.value).toFixed(1)}`)
  .join(" ");
const area = `${line} L${px(props.points.length - 1).toFixed(1)} ${padT + innerH} L${px(0).toFixed(1)} ${padT + innerH} Z`;
const grid = [0, 0.5, 1].map((factor) => ({
  y: padT + innerH - factor * innerH,
  label: Math.round(maxY * factor),
}));
const labelEvery = Math.max(1, Math.ceil(props.points.length / 6));
</script>

<template>
  <div class="chart" role="img" :aria-label="`Série de ${unit ?? 'valores'}`">
    <svg :viewBox="`0 0 ${W} ${H}`">
      <g v-for="row in grid" :key="row.y">
        <line :x1="padL" :x2="W - padR" :y1="row.y" :y2="row.y" class="axis" />
        <text :x="padL - 6" :y="row.y + 3" text-anchor="end">{{ row.label }}</text>
      </g>
      <path :d="area" class="area" />
      <path :d="line" class="line" />
      <template v-for="(point, index) in points" :key="point.label + index">
        <circle :cx="px(index)" :cy="py(point.value)" r="3" class="dot" />
        <title>{{ point.label }}: {{ point.value }} {{ unit ?? "" }}</title>
        <text
          v-if="index % labelEvery === 0 || index === points.length - 1"
          :x="px(index)"
          :y="H - 8"
          text-anchor="middle"
          class="xlabel"
        >
          {{ point.label }}
        </text>
      </template>
    </svg>
  </div>
</template>

<style scoped>
.chart {
  width: 100%;
}
svg {
  width: 100%;
  height: auto;
  overflow: visible;
}
.axis {
  stroke: var(--ins-border, #e5e8ee);
  stroke-dasharray: 2 3;
}
text {
  fill: var(--ins-ink-3, #8b93a1);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.area {
  fill: var(--ins-accent, #2b5fd9);
  opacity: 0.1;
}
.line {
  fill: none;
  stroke: var(--ins-accent, #2b5fd9);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.dot {
  fill: var(--ins-surface, #fff);
  stroke: var(--ins-accent, #2b5fd9);
  stroke-width: 2;
}
</style>
