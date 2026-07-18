<script setup lang="ts">
const { toasts, dismiss } = useToast()

const ICONS: Record<string, string> = {
  success: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  error: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
  info: 'M11.25 11.25l1.5 1.5m0 0l1.5 1.5m-1.5-1.5l-1.5 1.5m1.5-1.5l1.5-1.5M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Z',
}

const ACCENT: Record<string, string> = {
  success: 'var(--color-success)',
  error: 'var(--color-danger)',
  info: 'var(--accent-color)',
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-3 right-3 z-[100] flex flex-col gap-2 pointer-events-none" style="max-width: 360px;">
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm text-sm"
          :style="{
            background: 'var(--bg-surface)',
            borderColor: ACCENT[t.type] || 'var(--border-color)',
            color: 'var(--text-primary)',
          }"
        >
          <svg class="w-4 h-4 flex-shrink-0 mt-0.5" :style="{ color: ACCENT[t.type] || 'var(--text-muted)' }" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" :d="ICONS[t.type] || ICONS.info" />
          </svg>
          <p class="flex-1 whitespace-pre-wrap break-words">{{ t.message }}</p>
          <button
            type="button"
            class="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0 -mt-0.5"
            aria-label="关闭"
            @click="dismiss(t.id)"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active {
  transition: all 0.25s var(--ease-out);
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px) scale(0.95);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px) scale(0.95);
}
.toast-move {
  transition: transform 0.25s var(--ease-out);
}
</style>
