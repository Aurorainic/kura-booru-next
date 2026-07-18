<script setup lang="ts">
import type { TagClassificationSuggestion } from '~/types'

const props = defineProps<{
  ssrCookie: string
}>()

const toast = useToast()

const classifyMode = ref<'unprocessed' | 'all'>('unprocessed')
const classifyLoading = ref(false)
const classifyResults = ref<TagClassificationSuggestion[]>([])

// AI job polling (A5) — when POST returns a job_id, poll GET /jobs/:id until done.
const activeJobId = ref<string | null>(null)
const jobProgress = ref<{ done: number; total: number } | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  activeJobId.value = null
  jobProgress.value = null
}

async function pollJob(jobId: string) {
  try {
    const status = await getAiJobStatus(jobId, props.ssrCookie)
    jobProgress.value = { done: status.done, total: status.total }
    if (status.status === 'done' || status.status === 'error' || status.status === 'gone') {
      stopPolling()
      if (status.status === 'done' && status.result?.suggestions) {
        classifyResults.value = status.result.suggestions as TagClassificationSuggestion[]
      } else if (status.status === 'error') {
        toast.error(`分类失败: ${status.errors.join('; ') || '未知错误'}`)
      }
      classifyLoading.value = false
    }
  } catch { /* keep polling */ }
}

async function runClassify() {
  classifyLoading.value = true
  classifyResults.value = []
  try {
    const res = await classifyTagsAI({ mode: classifyMode.value }, props.ssrCookie)
    // Synchronous mode (specific) returns suggestions directly; async mode returns job_id.
    if (res.suggestions?.length) {
      classifyResults.value = res.suggestions
      classifyLoading.value = false
      return
    }
    if (res.job_id) {
      activeJobId.value = res.job_id
      jobProgress.value = { done: 0, total: 0 }
      pollTimer = setInterval(() => {
        if (activeJobId.value) pollJob(activeJobId.value)
      }, 1000)
    } else {
      classifyLoading.value = false
    }
  } catch (e: any) {
    classifyLoading.value = false
    toast.error(`分类失败: ${e.message || '未知错误'}`)
  }
}

const applyingTags = ref<Set<string>>(new Set())
async function applyClassification(s: TagClassificationSuggestion) {
  applyingTags.value.add(s.tag_name)
  try {
    const tagList = await fetchAdminTags({ q: s.tag_name, per_page: 1 }, props.ssrCookie)
    const tag = tagList.items?.[0]
    if (!tag) { toast.error('找不到标签'); return }
    await updateAdminTag(tag.id, {
      category: s.category,
      danbooru_name: s.danbooru_name || undefined,
      translation: s.translation || undefined,
    }, props.ssrCookie)
    classifyResults.value = classifyResults.value.filter(r => r.tag_name !== s.tag_name)
    // Confidence-aware toast: low-confidence classifications get a heads-up
    // so the admin knows to double-check the result before trusting it.
    if (s.confidence < 0.5) {
      toast.info(`已应用（置信度低 ${Math.round(s.confidence * 100)}%，建议人工复核）: ${s.tag_name}`)
    } else {
      toast.success(`已应用: ${s.tag_name}`)
    }
  } catch (e: any) {
    toast.error(`应用失败: ${e.message || '未知错误'}`)
  } finally {
    applyingTags.value.delete(s.tag_name)
  }
}

onUnmounted(stopPolling)
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <select v-model="classifyMode" class="text-xs px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--accent-color)]">
        <option value="unprocessed">未处理标签</option>
        <option value="all">全部标签</option>
      </select>
      <button @click="runClassify" :disabled="classifyLoading" class="btn-primary !text-xs !px-4 !py-2">
        {{ classifyLoading ? '处理中…' : '开始分类' }}
      </button>
      <span v-if="jobProgress && classifyLoading" class="text-xs text-[var(--text-muted)] font-mono tabular-nums">
        {{ jobProgress.done }} / {{ jobProgress.total || '…' }}
      </span>
    </div>

    <div v-if="classifyResults.length" class="rounded-2xl border border-[var(--border-color)] overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-[var(--border-color)]" style="background: var(--accent-subtle);">
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">标签</th>
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">分类</th>
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider hidden md:table-cell">Danbooru</th>
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider hidden md:table-cell">翻译</th>
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">置信度</th>
            <th class="text-right px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in classifyResults" :key="s.tag_name" class="border-b border-[var(--border-color)]/40 hover:bg-[var(--accent-subtle)]/50">
            <td class="px-4 py-2.5 font-medium text-[var(--text-primary)]">{{ s.tag_name }}</td>
            <td class="px-4 py-2.5">
              <span class="text-[0.625rem] px-2 py-1 rounded-md font-medium" :style="{ color: getTagCategoryVar(s.category), background: `${getTagCategoryVar(s.category)}15` }">{{ getTagCategoryLabel(s.category) }}</span>
            </td>
            <td class="px-4 py-2.5 hidden md:table-cell text-xs text-[var(--text-muted)]">{{ s.danbooru_name || '—' }}</td>
            <td class="px-4 py-2.5 hidden md:table-cell text-xs text-[var(--text-muted)]">{{ s.translation || '—' }}</td>
            <td class="px-4 py-2.5 text-xs text-[var(--text-muted)] font-mono">{{ Math.round(s.confidence * 100) }}%</td>
            <td class="px-4 py-2.5 text-right">
              <button @click="applyClassification(s)" :disabled="applyingTags.has(s.tag_name)" class="btn-primary !text-[0.625rem] !px-2.5 !py-1">
                {{ applyingTags.has(s.tag_name) ? '…' : '应用' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
