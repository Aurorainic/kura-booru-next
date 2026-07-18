<script setup lang="ts">
const { pending, resolve } = useConfirm()

function onKey(e: KeyboardEvent) {
  if (!pending.value) return
  if (e.key === 'Enter') { e.preventDefault(); resolve(true) }
  else if (e.key === 'Escape') { e.preventDefault(); resolve(false) }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm">
      <div
        v-if="pending"
        class="fixed inset-0 z-[101] flex items-center justify-center p-4"
        style="background: rgba(0,0,0,0.4); backdrop-filter: blur(2px);"
        @click.self="resolve(false)"
      >
        <div
          class="bg-[var(--bg-surface)] rounded-2xl p-6 w-[400px] max-w-[90vw] shadow-2xl border border-[var(--border-color)]/50"
          style="animation: modalZoomIn 0.2s var(--ease-out);"
          role="alertdialog"
          aria-modal="true"
        >
          <h3 v-if="pending.title" class="text-base font-bold mb-2 text-[var(--text-primary)]">{{ pending.title }}</h3>
          <p class="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{{ pending.message }}</p>
          <div class="flex justify-end gap-2 mt-5">
            <button
              type="button"
              class="px-4 py-2 text-sm rounded-xl border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              @click="resolve(false)"
            >{{ pending.cancelLabel || '取消' }}</button>
            <button
              type="button"
              class="px-5 py-2 text-sm font-semibold rounded-xl text-white transition-all active:scale-95"
              :style="pending.danger
                ? { background: 'var(--color-danger)' }
                : { background: 'var(--accent-color)', color: 'var(--bg-primary)' }"
              @click="resolve(true)"
            >{{ pending.confirmLabel || '确认' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-enter-active, .confirm-leave-active {
  transition: opacity 0.2s var(--ease-out);
}
.confirm-enter-from, .confirm-leave-to {
  opacity: 0;
}
</style>
