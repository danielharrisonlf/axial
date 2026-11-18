<script setup lang="ts">
import { catVar } from "../lib";
import type { InsightUser } from "../types";

/** Decorative avatar: every use shows the person's name next to it. */
defineProps<{ user: InsightUser | undefined; size?: "sm" | "lg" }>();
</script>

<template>
  <span v-if="user" class="avatar" :class="size" :style="{ '--av': catVar(user.color) }" aria-hidden="true">{{
    user.initials
  }}</span>
  <span v-else class="avatar none" :class="size" aria-hidden="true" />
</template>
