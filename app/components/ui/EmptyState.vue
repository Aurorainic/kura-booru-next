<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description?: string
  icon?: string
}>(), {
  description: '',
  icon: '',
})
</script>

<template>
  <div class="flex flex-col items-center justify-center py-12 text-[var(--text-muted)] text-center">
    <div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background: var(--accent-subtle);">
      <svg v-if="icon" class="w-6 h-6" style="color: var(--accent-color);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" :d="icon" /></svg>
      <svg v-else class="w-6 h-6" style="color: var(--accent-color);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3z" /></svg>
    </div>
    <p class="text-sm font-medium text-[var(--text-primary)]">{{ title }}</p>
    <p v-if="description" class="text-xs mt-0.5 max-w-xs">{{ description }}</p>
    <slot />
  </div>
</template>
