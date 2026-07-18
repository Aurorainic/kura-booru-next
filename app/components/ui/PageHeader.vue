<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <div class="flex items-end justify-between flex-wrap gap-3 mb-4">
    <div>
      <h2 class="text-lg font-bold tracking-tight" style="font-family: var(--font-display);">{{ title }}</h2>
      <p v-if="subtitle" class="text-xs text-[var(--text-muted)] mt-1">{{ subtitle }}</p>
    </div>
    <div class="flex items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
