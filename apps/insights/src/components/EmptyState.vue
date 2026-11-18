<script setup lang="ts">
import { Icon, type IconName } from "./Icon";

/** Empty state (.empty); `compact` is the inline variant used inside panels. */
defineProps<{ icon: IconName; title: string; msg?: string; compact?: boolean }>();
</script>

<template>
  <div class="empty" :class="{ inline: compact }">
    <div class="e-ic"><Icon :name="icon" :size="20" /></div>
    <b>{{ title }}</b>
    <p v-if="msg">{{ msg }}</p>
    <slot />
  </div>
</template>
