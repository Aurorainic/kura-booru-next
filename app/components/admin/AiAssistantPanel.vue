<script setup lang="ts">
import type { AiStatus } from '~/types'
import AiClassifyPanel from '~/components/admin/ai/AiClassifyPanel.vue'
import AiMergesPanel from '~/components/admin/ai/AiMergesPanel.vue'
import AiRatingsPanel from '~/components/admin/ai/AiRatingsPanel.vue'
import AiChatPanel from '~/components/admin/ai/AiChatPanel.vue'
import AiStatusBar from '~/components/admin/ai/AiStatusBar.vue'

const { ssrCookie } = useSsrContext()
const route = useRoute()

// ── AI Status (single fetch on mount; AdminStatusBar at page top also polls system queue) ──
const aiStatus = ref<AiStatus | null>(null)
const aiLoading = ref(true)

onMounted(async () => {
  try {
    aiStatus.value = await getAiStatus(ssrCookie.value)
  } catch (e: any) {
    console.error('[AiAssistantPanel] getAiStatus failed:', e?.message || e)
    aiStatus.value = null
  } finally {
    aiLoading.value = false
  }
})

const aiEnabled = computed(() => !!(aiStatus.value?.enabled && aiStatus.value?.endpoint && aiStatus.value?.model))

// ── Sub-section state (persisted to URL ?section=) ──
const sections = [
  { key: 'classify' as const, label: '标签分类', icon: 'M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3z' },
  { key: 'merges' as const, label: '合并建议', icon: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5' },
  { key: 'ratings' as const, label: '评级建议', icon: 'M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5z' },
  { key: 'chat' as const, label: 'AI 对话', icon: 'M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z' },
]

const activeSection = computed({
  get: () => (route.query.section as 'classify' | 'merges' | 'ratings' | 'chat') || 'classify',
  set: (v) => navigateTo({ query: { ...route.query, section: v } }, { replace: true }),
})

function switchSection(s: string) {
  activeSection.value = s as any
}
</script>

<template>
  <div class="space-y-4">
    <PageHeader title="AI 助手">
      <template #actions>
        <AiStatusBar v-if="aiStatus" :ai-status="aiStatus" :ai-enabled="aiEnabled" />
      </template>
    </PageHeader>

    <LoadingCard v-if="aiLoading" message="检测 AI 配置…" />

    <EmptyState
      v-else-if="!aiEnabled"
      title="AI 功能未启用"
      description="请在「AI 设置」标签页中添加并启用一个 Provider，然后打开 AI 标签处理开关"
      icon="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
    />

    <div v-else class="space-y-4">
      <!-- Section tabs (URL-persisted) -->
      <div class="flex items-center gap-1.5 overflow-x-auto">
        <button
          v-for="s in sections" :key="s.key"
          @click="switchSection(s.key)"
          class="filter-pill whitespace-nowrap inline-flex items-center gap-1.5"
          :class="{ active: activeSection === s.key }"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" :d="s.icon" /></svg>
          {{ s.label }}
        </button>
      </div>

      <KeepAlive>
        <AiClassifyPanel v-if="activeSection === 'classify'" :ssr-cookie="ssrCookie" />
        <AiMergesPanel v-else-if="activeSection === 'merges'" :ssr-cookie="ssrCookie" />
        <AiRatingsPanel v-else-if="activeSection === 'ratings'" :ssr-cookie="ssrCookie" />
        <AiChatPanel v-else-if="activeSection === 'chat'" :ssr-cookie="ssrCookie" />
        <AiClassifyPanel v-else :ssr-cookie="ssrCookie" />
      </KeepAlive>
    </div>
  </div>
</template>
