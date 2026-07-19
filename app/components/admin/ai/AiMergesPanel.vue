<script setup lang="ts">
import type { TagCategory, MergeSuggestion } from '~/types'

const props = defineProps<{
  ssrCookie: string
}>()

const toast = useToast()

const mergeScope = ref<'all' | TagCategory>('all')
const mergeLoading = ref(false)
const mergeResults = ref<MergeSuggestion[]>([])

const { start } = useAiJobPolling({
  intervalMs: 1000,
  ssrCookie: props.ssrCookie,
  onDone: (suggestions) => { mergeResults.value = suggestions as MergeSuggestion[] },
  onError: (errors) => toast.error(`扫描失败: ${errors.join('; ') || '未知错误'}`),
  onTerminal: () => { mergeLoading.value = false },
})

async function runMergeSuggest() {
  mergeLoading.value = true
  mergeResults.value = []
  try {
    const scope = mergeScope.value === 'all' ? 'all' : { category: mergeScope.value }
    const res = await suggestMergesAI({ scope: scope as any }, props.ssrCookie)
    if (res.suggestions?.length) {
      mergeResults.value = res.suggestions
      mergeLoading.value = false
      return
    }
    if (res.job_id) {
      start(res.job_id)
    } else {
      mergeLoading.value = false
    }
  } catch (e: any) {
    mergeLoading.value = false
    toast.error(`扫描失败: ${e.message || '未知错误'}`)
  }
}

const applyingMerge = ref<number>(-1)
async function applyMerge(idx: number, suggestion: MergeSuggestion) {
  applyingMerge.value = idx
  try {
    const [canonical, ...aliasTags] = await Promise.all([
      fetchAdminTags({ q: suggestion.canonical_name, per_page: 1 }, props.ssrCookie),
      ...suggestion.aliases.map(a => fetchAdminTags({ q: a, per_page: 1 }, props.ssrCookie)),
    ])
    const targetTag = canonical.items?.[0]
    if (!targetTag) { toast.error('找不到目标标签'); return }
    for (let i = 0; i < aliasTags.length; i++) {
      const sourceTag = aliasTags[i]?.items?.[0]
      if (sourceTag) {
        await mergeTags(sourceTag.id, targetTag.id, props.ssrCookie)
      }
    }
    mergeResults.value = mergeResults.value.filter((_, i) => i !== idx)
    toast.success('合并完成')
  } catch (e: any) {
    toast.error(`合并失败: ${e.message || '未知错误'}`)
  } finally {
    applyingMerge.value = -1
  }
}

const categoryOptions = [
  { value: 'all', label: '全部分类' },
  { value: 'artist', label: '画师' },
  { value: 'character', label: '角色' },
  { value: 'copyright', label: '作品' },
  { value: 'general', label: '通用' },
  { value: 'meta', label: '元信息' },
]
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <select v-model="mergeScope" class="text-xs px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--accent-color)]">
        <option v-for="c in categoryOptions" :key="c.value" :value="c.value">{{ c.label }}</option>
      </select>
      <button @click="runMergeSuggest" :disabled="mergeLoading" class="btn-primary !text-xs !px-4 !py-2">
        {{ mergeLoading ? '扫描中…' : '扫描合并建议' }}
      </button>
    </div>

    <div v-if="mergeResults.length" class="space-y-2">
      <div v-for="(g, idx) in mergeResults" :key="idx" class="dash-card !p-4">
        <div class="flex items-center gap-2 mb-2">
          <span class="font-medium text-sm text-[var(--text-primary)]">{{ g.canonical_name }}</span>
          <span class="text-[var(--text-muted)] text-xs">←</span>
          <span class="text-xs text-[var(--text-muted)]">{{ g.aliases.join(', ') }}</span>
          <span class="ml-auto text-[0.625rem] px-2 py-0.5 rounded-md" style="background: var(--accent-subtle); color: var(--accent-color);">{{ Math.round(g.confidence * 100) }}%</span>
        </div>
        <p class="text-xs text-[var(--text-muted)] mb-3">{{ g.reason }}</p>
        <button @click="applyMerge(idx, g)" :disabled="applyingMerge === idx" class="btn-primary !text-[0.625rem] !px-3 !py-1.5">
          {{ applyingMerge === idx ? '合并中…' : '执行合并' }}
        </button>
      </div>
    </div>
  </div>
</template>
