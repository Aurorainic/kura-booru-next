<script setup lang="ts">
const props = withDefaults(defineProps<{
  tagId: string
  label?: string
}>(), {
  label: 'ID',
})

const tooltipVisible = ref(false)
const copied = ref(false)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

function onMouseEnter() {
  hoverTimer = setTimeout(() => { tooltipVisible.value = true }, 200)
}

function onMouseLeave() {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = null
  tooltipVisible.value = false
}

async function onClick() {
  try {
    await navigator.clipboard.writeText(props.tagId)
    copied.value = true
    copyTimer = setTimeout(() => { copied.value = false }, 1500)
  } catch {
    // clipboard write failed silently
  }
}

let copyTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  if (hoverTimer) clearTimeout(hoverTimer)
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<template>
  <span
    class="relative inline-flex items-center cursor-pointer select-none group"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @click="onClick"
  >
    <span class="text-[0.75rem] text-[var(--text-muted)] font-mono underline decoration-dotted decoration-[var(--border-color)] underline-offset-2 hover:text-[var(--accent-color)] transition-colors">{{ label }}</span>
    <Transition name="tooltip-fade">
      <span
        v-if="tooltipVisible && !copied"
        class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--bg-surface)] border border-[var(--border-color)] text-[0.6875rem] text-[var(--text-primary)] font-mono whitespace-nowrap shadow-md z-50"
      >
        {{ tagId }}
      </span>
    </Transition>
    <Transition name="tooltip-fade">
      <span
        v-if="copied"
        class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--color-success)] text-white text-[0.6875rem] whitespace-nowrap shadow-md z-50"
      >
        已复制
      </span>
    </Transition>
  </span>
</template>

<style scoped>
.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity 0.15s ease-out;
}
.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}
</style>
