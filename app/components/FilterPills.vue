<script setup lang="ts">
defineProps<{
  options: { value: string; label: string }[]
  modelValue: string
}>()

defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div class="flex items-center gap-4 flex-wrap">
    <NuxtLink
      v-for="opt in options"
      :key="opt.value"
      :to="opt.value ? `?${opt.value}` : '?'"
      class="filter-pill"
      :class="{ active: modelValue === opt.value }"
    >
      {{ opt.label }}
    </NuxtLink>
  </div>
</template>
