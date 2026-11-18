<script setup lang="ts">
import { ref, watch } from "vue";
import { useTip } from "../state";

const tip = useTip();
const el = ref<HTMLElement | null>(null);
const left = ref(0);
const top = ref(0);

// centered above the anchor point, clamped to the viewport (as in the prototype)
watch(
  () => [tip.lines, tip.x, tip.y],
  () => {
    const node = el.value;
    if (!node || !tip.lines) return;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    left.value = Math.max(8, Math.min(tip.x - width / 2, window.innerWidth - width - 8));
    top.value = Math.max(8, tip.y - height - 12);
  },
  { flush: "post" },
);
</script>

<template>
  <div
    ref="el"
    class="tooltip"
    role="tooltip"
    :hidden="!tip.lines"
    :style="{ left: `${left}px`, top: `${top}px` }"
  >{{ tip.lines?.join("\n") }}</div>
</template>
