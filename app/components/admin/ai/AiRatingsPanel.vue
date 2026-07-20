<script setup lang="ts">
import type { RatingSuggestionItem } from '~/types'

const props = defineProps<{
  ssrCookie: string
}>()

const toast = useToast()

const ratingScope = ref<'unrated' | 'all'>('unrated')
const ratingLoading = ref(false)
const ratingResults = ref<RatingSuggestionItem[]>([])

const { jobProgress, start } = useAiJobPolling({
  intervalMs: 1500,  // rating jobs are slow (200ms/post); poll less aggressively
  ssrCookie: props.ssrCookie,
  onDone: (suggestions) => { ratingResults.value = suggestions as RatingSuggestionItem[] },
  onError: (errors) => toast.error(`扫描失败: ${errors.join('; ') || '未知错误'}`),
  onTerminal: () => { ratingLoading.value = false },
})

async function runRatingSuggest() {
  ratingLoading.value = true
  ratingResults.value = []
  try {
    const res = await suggestRatingsAI({ scope: ratingScope.value, limit: 30 }, props.ssrCookie)
    if (res.suggestions?.length) {
      ratingResults.value = res.suggestions
      ratingLoading.value = false
      return
    }
    if (res.job_id) {
      start(res.job_id)
    } else {
      ratingLoading.value = false
    }
  } catch (e: any) {
    ratingLoading.value = false
    toast.error(`扫描失败: ${e.message || '未知错误'}`)
  }
}

const applyingRating = ref<Set<string>>(new Set())
async function applyRatingSuggestion(s: RatingSuggestionItem) {
  applyingRating.value.add(s.post_id)
  try {
    await updatePostRating(s.post_id, s.rating)
    ratingResults.value = ratingResults.value.filter(r => r.post_id !== s.post_id)
    toast.success('评级已应用')
  } catch (e: any) {
    toast.error(`应用失败: ${e.message || '未知错误'}`)
  } finally {
    applyingRating.value.delete(s.post_id)
  }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <select v-model="ratingScope" class="text-xs px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--accent-color)]">
        <option value="unrated">仅 safe（可能需要升级）</option>
        <option value="all">全部图片</option>
      </select>
      <button @click="runRatingSuggest" :disabled="ratingLoading" class="btn-primary !text-xs !px-4 !py-2">
        {{ ratingLoading ? '扫描中…' : '扫描评级建议' }}
      </button>
      <span v-if="jobProgress && ratingLoading" class="text-xs text-[var(--text-muted)] font-mono tabular-nums">
        {{ jobProgress.done }} / {{ jobProgress.total || '…' }}
      </span>
    </div>

    <div v-if="ratingResults.length" class="rounded-2xl border border-[var(--border-color)] overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-[var(--border-color)]" style="background: var(--accent-subtle);">
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">帖子</th>
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">当前</th>
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">建议</th>
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider hidden md:table-cell">原因</th>
            <th class="text-right px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in ratingResults" :key="s.post_id" class="border-b border-[var(--border-color)]/40 hover:bg-[var(--accent-subtle)]/50">
            <td class="px-4 py-2.5">
              <NuxtLink :to="`/posts/${s.post_id}`" class="font-mono text-xs text-[var(--accent-color)] hover:underline">{{ s.post_id.slice(0, 8) }}…</NuxtLink>
            </td>
            <td class="px-4 py-2.5">
              <span class="text-[0.625rem] px-2 py-1 rounded-md font-medium" :class="getRatingColorClass(s.current_rating)">{{ getRatingLabel(s.current_rating) }}</span>
            </td>
            <td class="px-4 py-2.5">
              <span class="text-[0.625rem] px-2 py-1 rounded-md font-medium" :class="getRatingColorClass(s.rating)">{{ getRatingLabel(s.rating) }}</span>
              <span class="text-[0.5625rem] text-[var(--text-muted)] ml-1">{{ Math.round(s.confidence * 100) }}%</span>
            </td>
            <td class="px-4 py-2.5 hidden md:table-cell text-xs text-[var(--text-muted)] max-w-[200px] truncate" :title="s.reason">{{ s.reason }}</td>
            <td class="px-4 py-2.5 text-right">
              <button @click="applyRatingSuggestion(s)" :disabled="applyingRating.has(s.post_id)" class="btn-primary !text-[0.625rem] !px-2.5 !py-1">
                {{ applyingRating.has(s.post_id) ? '…' : '应用' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
