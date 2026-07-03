<script setup lang="ts">
const props = defineProps<{
  tagId: string
}>()

const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyId() {
  try {
    await navigator.clipboard.writeText(props.tagId)
    copied.value = true
    copyTimer = setTimeout(() => { copied.value = false }, 1500)
  } catch {
    // clipboard write failed silently
  }
}

onUnmounted(() => {
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.625rem] font-mono text-[var(--text-muted)] hover:text-[var(--accent-color)] hover:bg-[var(--accent-subtle)] transition-all select-none"
    :title="tagId"
    @click="copyId"
  >
    <svg v-if="!copied" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
    <svg v-else class="w-3 h-3 text-[var(--color-success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
    <span>{{ copied ? '已复制' : 'ID' }}</span>
  </button>
</template>
