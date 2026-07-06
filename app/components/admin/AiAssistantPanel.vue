<script setup lang="ts">
import type { TagCategory, TagClassificationSuggestion, MergeSuggestion, RatingSuggestionItem, AssistantReply, AiStatus } from '~/types'

const { ssrCookie } = useSsrContext()

// ── AI Status ──
const aiStatus = ref<AiStatus | null>(null)
const aiLoading = ref(true)

onMounted(async () => {
  try {
    const resp = await fetch('/api/admin/ai/status', { credentials: 'include' })
    if (!resp.ok) throw new Error(`API ${resp.status}`)
    aiStatus.value = await resp.json()
  } catch (e: any) {
    console.error('[AiAssistantPanel] getAiStatus failed:', e?.message || e)
    aiStatus.value = null
  }
  finally { aiLoading.value = false }
})

// ponytail: template calls new URL() which breaks in code-split chunks (URL auto-import not bound)
// expose a plain function the template can call safely
function endpointHost(ep: string | undefined): string {
  try { return ep ? new URL(ep).hostname : '' } catch { return '' }
}

const aiEnabled = computed(() => aiStatus.value?.enabled && aiStatus.value?.endpoint && aiStatus.value?.model)

// ── Sub-section state ──
const activeSection = ref<'classify' | 'merges' | 'ratings' | 'chat'>('classify')

// ── ① Tag Classification ──
const classifyMode = ref<'unprocessed' | 'all'>('unprocessed')
const classifyLoading = ref(false)
const classifyResults = ref<TagClassificationSuggestion[]>([])

async function runClassify() {
  classifyLoading.value = true
  classifyResults.value = []
  try {
    const res = await classifyTagsAI({ mode: classifyMode.value }, ssrCookie.value)
    classifyResults.value = res.suggestions || []
  } catch (e: any) {
    alert(`分类失败: ${e.message || '未知错误'}`)
  } finally {
    classifyLoading.value = false
  }
}

const applyingTags = ref<Set<string>>(new Set())
async function applyClassification(s: TagClassificationSuggestion) {
  // Find tag by name to get its ID
  applyingTags.value.add(s.tag_name)
  try {
    const tagList = await fetchAdminTags({ q: s.tag_name, per_page: 1 }, ssrCookie.value)
    const tag = tagList.items?.[0]
    if (!tag) { alert('找不到标签'); return }
    await updateAdminTag(tag.id, {
      category: s.category,
      danbooru_name: s.danbooru_name || undefined,
      translation: s.translation || undefined,
    }, ssrCookie.value)
    classifyResults.value = classifyResults.value.filter(r => r.tag_name !== s.tag_name)
  } catch (e: any) {
    alert(`应用失败: ${e.message || '未知错误'}`)
  } finally {
    applyingTags.value.delete(s.tag_name)
  }
}

// ── ② Merge Suggestions ──
const mergeScope = ref<'all' | TagCategory>('all')
const mergeLoading = ref(false)
const mergeResults = ref<MergeSuggestion[]>([])

async function runMergeSuggest() {
  mergeLoading.value = true
  mergeResults.value = []
  try {
    const scope = mergeScope.value === 'all' ? 'all' : { category: mergeScope.value }
    const res = await suggestMergesAI({ scope: scope as any }, ssrCookie.value)
    mergeResults.value = res.suggestions || []
  } catch (e: any) {
    alert(`扫描失败: ${e.message || '未知错误'}`)
  } finally {
    mergeLoading.value = false
  }
}

const applyingMerge = ref<number>(-1)
async function applyMerge(idx: number, suggestion: MergeSuggestion) {
  applyingMerge.value = idx
  try {
    // Find tag IDs by name
    const [canonical, ...aliasTags] = await Promise.all([
      fetchAdminTags({ q: suggestion.canonical_name, per_page: 1 }, ssrCookie.value),
      ...suggestion.aliases.map(a => fetchAdminTags({ q: a, per_page: 1 }, ssrCookie.value)),
    ])
    const targetTag = canonical.items?.[0]
    if (!targetTag) { alert('找不到目标标签'); return }
    for (let i = 0; i < aliasTags.length; i++) {
      const sourceTag = aliasTags[i]?.items?.[0]
      if (sourceTag) {
        await mergeTags(sourceTag.id, targetTag.id, ssrCookie.value)
      }
    }
    mergeResults.value = mergeResults.value.filter((_, i) => i !== idx)
  } catch (e: any) {
    alert(`合并失败: ${e.message || '未知错误'}`)
  } finally {
    applyingMerge.value = -1
  }
}

// ── ③ Rating Suggestions ──
const ratingScope = ref<'unrated' | 'all'>('unrated')
const ratingLoading = ref(false)
const ratingResults = ref<RatingSuggestionItem[]>([])

async function runRatingSuggest() {
  ratingLoading.value = true
  ratingResults.value = []
  try {
    const res = await suggestRatingsAI({ scope: ratingScope.value, limit: 30 }, ssrCookie.value)
    ratingResults.value = res.suggestions || []
  } catch (e: any) {
    alert(`扫描失败: ${e.message || '未知错误'}`)
  } finally {
    ratingLoading.value = false
  }
}

const applyingRating = ref<Set<string>>(new Set())
async function applyRatingSuggestion(s: RatingSuggestionItem) {
  applyingRating.value.add(s.post_id)
  try {
    await updatePostRating(s.post_id, s.rating)
    ratingResults.value = ratingResults.value.filter(r => r.post_id !== s.post_id)
  } catch (e: any) {
    alert(`应用失败: ${e.message || '未知错误'}`)
  } finally {
    applyingRating.value.delete(s.post_id)
  }
}

function getConfidencePercent(c: number): string {
  return `${Math.round(c * 100)}%`
}

// ── ④ Chat ──
const chatInput = ref('')
const chatLoading = ref(false)
const chatMessages = ref<{ role: 'user' | 'assistant'; content: string; suggestions?: any[] }[]>([])

async function sendChat() {
  const q = chatInput.value.trim()
  if (!q || chatLoading.value) return

  chatMessages.value.push({ role: 'user', content: q })
  chatInput.value = ''
  chatLoading.value = true

  try {
    const reply = await adminChat({ query: q, lang: 'zh' }, ssrCookie.value)
    chatMessages.value.push({ role: 'assistant', content: reply.text, suggestions: reply.suggestions })
  } catch (e: any) {
    chatMessages.value.push({ role: 'assistant', content: `错误: ${e.message || '未知错误'}` })
  } finally {
    chatLoading.value = false
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

const sections = [
  { key: 'classify' as const, label: '标签分类', icon: 'M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3z' },
  { key: 'merges' as const, label: '合并建议', icon: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5' },
  { key: 'ratings' as const, label: '评级建议', icon: 'M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5z' },
  { key: 'chat' as const, label: 'AI 对话', icon: 'M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z' },
]
</script>

<template>
  <div class="space-y-4">
    <!-- Header with status -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-lg font-bold tracking-tight" style="font-family: var(--font-display);">AI 助手</h2>
      <div v-if="aiStatus" class="flex items-center gap-2 text-xs">
        <span class="w-2 h-2 rounded-full" :class="aiEnabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'" />
        <span class="text-[var(--text-muted)]">
          {{ aiEnabled ? `${aiStatus.model}` : 'AI 未启用' }}
        </span>
        <span v-if="aiEnabled && aiStatus.endpoint" class="text-[var(--text-muted)]/60">{{ endpointHost(aiStatus.endpoint) }}</span>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="aiLoading" class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-8 flex flex-col items-center justify-center text-[var(--text-muted)]">
      <div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background: var(--accent-subtle);">
        <svg class="w-6 h-6 animate-spin" style="color: var(--accent-color);" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
      </div>
      <p class="text-sm font-medium">检测 AI 配置…</p>
    </div>

    <!-- Not enabled state -->
    <div v-else-if="!aiEnabled" class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-8 flex flex-col items-center justify-center text-[var(--text-muted)]">
      <div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background: var(--accent-subtle);">
        <svg class="w-6 h-6" style="color: var(--accent-color);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
      </div>
      <p class="text-sm font-medium mb-1">AI 功能未启用</p>
      <p class="text-xs">请设置 ENABLE_AI_TAG_PROCESSING=true 及相关 AI_PROVIDER_* 环境变量</p>
    </div>

    <!-- Main content when enabled -->
    <div v-else class="space-y-4">
      <!-- Section tabs -->
      <div class="flex items-center gap-1.5 overflow-x-auto">
        <button
          v-for="s in sections" :key="s.key"
          @click="activeSection = s.key"
          class="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all whitespace-nowrap"
          :class="activeSection === s.key ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-subtle)]'"
          :style="activeSection === s.key ? { background: 'var(--accent-color)' } : {}"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" :d="s.icon" /></svg>
          {{ s.label }}
        </button>
      </div>

      <!-- ① Classify -->
      <div v-if="activeSection === 'classify'" class="space-y-3">
        <div class="flex items-center gap-2 flex-wrap">
          <select v-model="classifyMode" class="text-xs px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--accent-color)]">
            <option value="unprocessed">未处理标签</option>
            <option value="all">全部标签</option>
          </select>
          <button @click="runClassify" :disabled="classifyLoading" class="px-4 py-2 text-xs font-medium rounded-lg transition-all active:scale-95" style="background: var(--accent-color); color: var(--bg-primary);">
            {{ classifyLoading ? '处理中…' : '开始分类' }}
          </button>
        </div>

        <div v-if="classifyResults.length" class="rounded-2xl border border-[var(--border-color)] overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-[var(--border-color)]" style="background: var(--accent-subtle);">
                <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">标签</th>
                <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">分类</th>
                <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider hidden md:table-cell">Danbooru</th>
                <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider hidden md:table-cell">翻译</th>
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
                <td class="px-4 py-2.5 text-right">
                  <button @click="applyClassification(s)" :disabled="applyingTags.has(s.tag_name)" class="px-2.5 py-1 text-[0.625rem] font-semibold rounded-lg transition-all active:scale-95" style="background: var(--accent-color); color: var(--bg-primary);">
                    {{ applyingTags.has(s.tag_name) ? '…' : '应用' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ② Merges -->
      <div v-if="activeSection === 'merges'" class="space-y-3">
        <div class="flex items-center gap-2 flex-wrap">
          <select v-model="mergeScope" class="text-xs px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--accent-color)]">
            <option v-for="c in categoryOptions" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
          <button @click="runMergeSuggest" :disabled="mergeLoading" class="px-4 py-2 text-xs font-medium rounded-lg transition-all active:scale-95" style="background: var(--accent-color); color: var(--bg-primary);">
            {{ mergeLoading ? '扫描中…' : '扫描合并建议' }}
          </button>
        </div>

        <div v-if="mergeResults.length" class="space-y-2">
          <div v-for="(g, idx) in mergeResults" :key="idx" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4">
            <div class="flex items-center gap-2 mb-2">
              <span class="font-medium text-sm text-[var(--text-primary)]">{{ g.canonical_name }}</span>
              <span class="text-[var(--text-muted)] text-xs">←</span>
              <span class="text-xs text-[var(--text-muted)]">{{ g.aliases.join(', ') }}</span>
              <span class="ml-auto text-[0.625rem] px-2 py-0.5 rounded-md" style="background: var(--accent-subtle); color: var(--accent-color);">{{ getConfidencePercent(g.confidence) }}</span>
            </div>
            <p class="text-xs text-[var(--text-muted)] mb-3">{{ g.reason }}</p>
            <button @click="applyMerge(idx, g)" :disabled="applyingMerge === idx" class="px-3 py-1.5 text-[0.625rem] font-semibold rounded-lg transition-all active:scale-95" style="background: var(--accent-color); color: var(--bg-primary);">
              {{ applyingMerge === idx ? '合并中…' : '执行合并' }}
            </button>
          </div>
        </div>
      </div>

      <!-- ③ Ratings -->
      <div v-if="activeSection === 'ratings'" class="space-y-3">
        <div class="flex items-center gap-2 flex-wrap">
          <select v-model="ratingScope" class="text-xs px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--accent-color)]">
            <option value="unrated">仅 safe（可能需要升级）</option>
            <option value="all">全部图片</option>
          </select>
          <button @click="runRatingSuggest" :disabled="ratingLoading" class="px-4 py-2 text-xs font-medium rounded-lg transition-all active:scale-95" style="background: var(--accent-color); color: var(--bg-primary);">
            {{ ratingLoading ? '扫描中…' : '扫描评级建议' }}
          </button>
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
                  <span class="text-[0.5625rem] text-[var(--text-muted)] ml-1">{{ getConfidencePercent(s.confidence) }}</span>
                </td>
                <td class="px-4 py-2.5 hidden md:table-cell text-xs text-[var(--text-muted)] max-w-[200px] truncate" :title="s.reason">{{ s.reason }}</td>
                <td class="px-4 py-2.5 text-right">
                  <button @click="applyRatingSuggestion(s)" :disabled="applyingRating.has(s.post_id)" class="px-2.5 py-1 text-[0.625rem] font-semibold rounded-lg transition-all active:scale-95" style="background: var(--accent-color); color: var(--bg-primary);">
                    {{ applyingRating.has(s.post_id) ? '…' : '应用' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ④ Chat -->
      <div v-if="activeSection === 'chat'" class="space-y-3">
        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 min-h-[300px] max-h-[500px] overflow-y-auto space-y-3">
          <div v-if="!chatMessages.length" class="flex items-center justify-center h-48 text-[var(--text-muted)] text-xs">
            向 AI 助手提问，例如："哪些标签缺少翻译？"
          </div>
          <div v-for="(msg, idx) in chatMessages" :key="idx" class="flex" :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
            <div class="max-w-[80%] rounded-xl px-3 py-2 text-sm" :class="msg.role === 'user' ? 'text-white' : 'text-[var(--text-primary)] border border-[var(--border-color)]'" :style="msg.role === 'user' ? { background: 'var(--accent-color)' } : { background: 'var(--bg-surface)' }">
              <p class="whitespace-pre-wrap">{{ msg.content }}</p>
              <div v-if="msg.suggestions?.length" class="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-[var(--border-color)]/30">
                <button v-for="(s, si) in msg.suggestions" :key="si" class="px-2 py-1 text-[0.5625rem] rounded-md border border-[var(--accent-color)]/40 text-[var(--accent-color)] hover:bg-[var(--accent-subtle)] transition-colors">
                  {{ s.label }}
                </button>
              </div>
            </div>
          </div>
          <div v-if="chatLoading" class="flex justify-start">
            <div class="rounded-xl px-3 py-2 text-sm text-[var(--text-muted)] border border-[var(--border-color)]">
              <span class="animate-pulse">思考中…</span>
            </div>
          </div>
        </div>
        <div class="flex gap-2">
          <input
            v-model="chatInput"
            type="text"
            placeholder="向 AI 助手提问…"
            class="flex-1 px-3 py-2.5 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-color)] transition-colors"
            @keydown.enter="sendChat"
          />
          <button @click="sendChat" :disabled="chatLoading || !chatInput.trim()" class="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-50" style="background: var(--accent-color); color: var(--bg-primary);">
            发送
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
