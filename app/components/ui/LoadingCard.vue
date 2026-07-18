<script setup lang="ts">
withDefaults(defineProps<{
  message?: string
}>(), {
  message: '加载中…',
})
</script>

<template>
  <div class="dash-card !p-8 flex flex-col items-center justify-center text-[var(--text-muted)]">
    <div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background: var(--accent-subtle);">
      <svg class="w-6 h-6 animate-spin" style="color: var(--accent-color);" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
    <p class="text-sm font-medium">{{ message }}</p>
  </div>
</template>
