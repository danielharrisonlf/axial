<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useTip } from "../state";

/**
 * Single-series line chart drawn at the container's real width (1 SVG unit =
 * 1px), so labels stay 12px at any width; redrawn when the container resizes.
 * The full series is in the aria-label; the hover tooltip is a mouse aid only.
 */
const props = defineProps<{ points: { label: string; y: number }[]; label: string; unit: string }>();

const tip = useTip();
const wrap = ref<HTMLElement | null>(null);
const width = ref(640);
const active = ref<number | null>(null);
const dots: (SVGCircleElement | null)[] = [];

const H = 200;
const padL = 32;
const padR = 12;
const padT = 16;
const padB = 28;
const ih = H - padT - padB;

/** Y ceiling divisible into 4 whole bands (0, 2, 4, 6, 8 …). */
function niceMax(value: number): number {
  const raw = Math.max(1, value / 4);
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p * 4;
}

const chart = computed(() => {
  const W = width.value;
  const n = props.points.length;
  const iw = W - padL - padR;
  const maxY = niceMax(Math.max(0, ...props.points.map((point) => point.y)));
  const px = (i: number) => padL + (n < 2 ? iw / 2 : (i * iw) / (n - 1));
  const py = (v: number) => padT + ih - (v / maxY) * ih;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: Math.round(padT + ih - f * ih) + 0.5,
    label: String(Math.round(maxY * f)),
    axis: f === 0,
  }));
  // x labels: as many as fit (>= 64px apart); first left-aligned, last right-aligned
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
  const xLabels = props.points.flatMap((point, i) => {
    const last = i === n - 1;
    if (i % step !== 0 && !last) return [];
    if (!last && n - 1 - i < step / 2 && i !== 0) return []; // keeps clear of the last label
    return [{ x: px(i), label: point.label, anchor: i === 0 ? "start" : last ? "end" : "middle" }];
  });
  const line = props.points
    .map((point, i) => `${i ? "L" : "M"}${px(i).toFixed(1)} ${py(point.y).toFixed(1)}`)
    .join(" ");
  const area = n ? `${line} L${px(n - 1).toFixed(1)} ${padT + ih} L${px(0).toFixed(1)} ${padT + ih} Z` : "";
  const band = Math.max(12, iw / Math.max(1, n - 1));
  const dotsAt = props.points.map((point, i) => ({ cx: px(i), cy: py(point.y), hitX: px(i) - band / 2 }));
  const lastPoint = props.points[n - 1];
  return {
    W,
    grid,
    xLabels,
    line,
    area,
    band,
    dots: dotsAt,
    last: lastPoint ? { x: px(n - 1) - 8, y: py(lastPoint.y) - 10, label: String(lastPoint.y) } : null,
  };
});

function setDot(index: number, el: unknown) {
  dots[index] = el instanceof SVGCircleElement ? el : null;
}
function enter(index: number) {
  const point = props.points[index];
  const dot = dots[index];
  if (!point || !dot) return;
  const rect = dot.getBoundingClientRect();
  tip.show(rect.left + rect.width / 2, rect.top, [point.label, `${point.y} ${props.unit}`]);
  active.value = index;
}
function leave() {
  tip.hide();
  active.value = null;
}

let observer: ResizeObserver | null = null;
let frame = 0;
function fit() {
  const w = Math.round(wrap.value?.clientWidth ?? 0);
  if (w > 0 && w !== width.value) width.value = w;
}
onMounted(() => {
  if (wrap.value && "ResizeObserver" in window) {
    observer = new ResizeObserver(fit);
    observer.observe(wrap.value);
  }
  frame = requestAnimationFrame(fit);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(frame);
  if (active.value != null) tip.hide();
});
</script>

<template>
  <div ref="wrap" class="chart">
    <svg
      :viewBox="`0 0 ${chart.W} ${H}`"
      :width="chart.W"
      :height="H"
      role="img"
      :aria-label="label"
    >
      <template v-for="row in chart.grid" :key="row.y">
        <line :x1="padL" :x2="chart.W - padR" :y1="row.y" :y2="row.y" :class="row.axis ? 'axis' : 'grid-line'" />
        <text :x="padL - 8" :y="row.y + 4" text-anchor="end">{{ row.label }}</text>
      </template>
      <text v-for="item in chart.xLabels" :key="`x${item.x}`" :x="item.x" :y="H - 8" :text-anchor="item.anchor">{{
        item.label
      }}</text>
      <path class="ch-area" :d="chart.area" />
      <line
        class="ch-cross"
        :class="{ on: active != null }"
        :x1="active != null ? chart.dots[active]?.cx : 0"
        :x2="active != null ? chart.dots[active]?.cx : 0"
        :y1="padT"
        :y2="padT + ih"
      />
      <path class="ch-line" :d="chart.line" />
      <template v-for="(dot, index) in chart.dots" :key="index">
        <circle
          :ref="(el) => setDot(index, el)"
          class="ch-dot"
          :class="{ last: index === chart.dots.length - 1 }"
          :cx="dot.cx"
          :cy="dot.cy"
          :r="active === index ? 5 : index === chart.dots.length - 1 ? 4 : 3"
        />
        <rect
          class="ch-hit"
          :x="dot.hitX"
          :y="padT"
          :width="chart.band"
          :height="ih"
          @mousemove="enter(index)"
          @mouseleave="leave"
        />
      </template>
      <text v-if="chart.last" class="ch-val" :x="chart.last.x" :y="chart.last.y" text-anchor="end">{{
        chart.last.label
      }}</text>
    </svg>
  </div>
</template>
