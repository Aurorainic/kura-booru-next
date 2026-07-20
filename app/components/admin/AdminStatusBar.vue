<script setup lang="ts">
// AdminStatusBar: consolidated top-of-page status bar.
// Replaces the duplicate system-status polling in DashboardPanel and the AI
// status line in AiAssistantPanel. One poller, two indicators.
import type { AiStatus } from '~/types'

const { ssrCookie } = useSsrContext()

const systemStatus = ref<{ queue_depth: number } | null>(null)
const aiStatus = ref<AiStatus | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null
let alive = true

const aiEnabled = computed(() => aiStatus.value?.enabled && aiStatus.value?.endpoint && aiStatus.value?.model)

function endpointHost(ep: string | undefined | null): string {
  try { return ep ? new URL(ep).hostname : '' } catch { return '' }
}

onMounted(() => {
  alive = true
  Promise.all([
    fetchSystemStatus().then(s => { if (alive) systemStatus.value = s }).catch(() => {}),
    getAiStatus(ssrCookie.value).then(s => { if (alive) aiStatus.value = s }).catch(() => {}),
  ])
  pollTimer = setInterval(async () => {
    if (!alive || document.visibilityState !== 'visible') return
    try { systemStatus.value = await fetchSystemStatus() } catch { /* ignore */ }
  }, 5000)
})

onUnmounted(() => {
  alive = false
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="flex items-center gap-4 text-xs text-[var(--text-muted)] py-1.5 px-1 flex-wrap">
    <!-- System queue -->
    <span class="inline-flex items-center gap-1.5">
      <span
        class="w-1.5 h-1.5 rounded-full"
        :class="systemStatus ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)] animate-pulse'"
      />
      <span>队列</span>
      <span class="font-mono tabular-nums text-[var(--text-primary)]">{{ systemStatus?.queue_depth ?? '…' }}</span>
    </span>

    <!-- AI status -->
    <span v-if="aiStatus" class="inline-flex items-center gap-1.5">
      <span
        class="w-1.5 h-1.5 rounded-full"
        :class="aiEnabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'"
      />
      <span>AI</span>
      <span v-if="aiEnabled" class="text-[var(--text-primary)] font-mono">{{ aiStatus.model }}</span>
      <span v-if="aiEnabled && aiStatus.endpoint" class="text-[var(--text-muted)]/60">{{ endpointHost(aiStatus.endpoint) }}</span>
      <span v-else class="text-[var(--text-muted)]">未启用</span>
    </span>
  </div>
</template>
