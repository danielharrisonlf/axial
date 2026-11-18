<script setup lang="ts">
import { STATUS_META } from "../lib";
import type { InsightStatus } from "../types";

/** Linear-style status ring; decorative, the status label is always next to it. */
withDefaults(defineProps<{ status: InsightStatus; size?: number }>(), { size: 14 });
</script>

<template>
  <span :style="{ display: 'inline-flex', flex: 'none', color: STATUS_META[status].color }" aria-hidden="true">
    <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" focusable="false">
      <template v-if="status === 'done'">
        <circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" />
        <path d="m8.6 12.2 2.3 2.3 4.5-4.7" stroke="var(--surface)" stroke-width="2" />
      </template>
      <template v-else>
        <circle cx="12" cy="12" r="7" :stroke-dasharray="status === 'backlog' ? '3.2 3.2' : undefined" />
        <path v-if="status === 'in_progress'" d="M12 12V5.4A6.6 6.6 0 0 1 12 18.6z" fill="currentColor" stroke="none" />
        <path v-if="status === 'in_review'" d="M12 12V5.4A6.6 6.6 0 1 1 5.4 12z" fill="currentColor" stroke="none" />
      </template>
    </svg>
  </span>
</template>
