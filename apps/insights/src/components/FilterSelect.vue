<script setup lang="ts">
/** Labelled filter (.fsel): the label stays visible; `is-set` when the value differs from the default. */
withDefaults(defineProps<{ label: string; options: { value: string; label: string }[]; def?: string }>(), {
  def: "",
});
const model = defineModel<string>({ required: true });
</script>

<template>
  <label class="fsel" :class="{ 'is-set': model !== def }">
    <span class="fsel-l" aria-hidden="true">{{ label }}</span>
    <select v-model="model" class="select" :aria-label="label">
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
  </label>
</template>
