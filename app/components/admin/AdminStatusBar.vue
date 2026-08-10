<script setup lang="ts">
// AdminStatusBar: consolidated top-of-page bar. Shares aiStatus with admin panels via useState,
// replacing the duplicate getAiStatus calls in AiAssistantPanel.
import type { AiStatus } from '~/types'

const { ssrCookie } = useSsrContext()

const systemStatus = ref<{ queue_depth: number } | null>(null)
const aiStatus = ref<AiStatus | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null
let alive = true

// H2: 单人 admin 看队列深度 5s 与 30s 几乎无差别 — 30s 减少 83% 请求量。
const POLL_INTERVAL = 30_000

const aiEnabled = computed(() => aiStatus.value?.enabled && aiStatus.value?.endpoint && aiStatus.value?.model)

// Share AI status via useState so sibling panels skip the duplicate getAiStatus call. (H5 fix)
const sharedAiStatus = useState<AiStatus | null>('sharedAiStatus', () => null)
watch(aiStatus, (v) => { sharedAiStatus.value = v }, { immediate: true })

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
  }, POLL_INTERVAL)
})

onUnmounted(() => {
  alive = false
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="flex items-center gap-4 text-xs text-[var(--text-muted)] py-1.5 px-1 flex-wrap">
    <span class="inline-flex items-center gap-1.5">
      <span
        class="w-1.5 h-1.5 rounded-full"
        :class="systemStatus ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)] animate-pulse'"
      />
      <span>队列</span>
      <span class="font-mono tabular-nums text-[var(--text-primary)]">{{ systemStatus?.queue_depth ?? '…' }}</span>
    </span>

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
