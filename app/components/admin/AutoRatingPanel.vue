<script setup lang="ts">
import type { Rating, Tag } from '~/types'

const { ssrCookie } = useSsrContext()
const { data: rules } = await useAsyncData('auto-rating-rules', async () => {
  try { return await fetchAutoRatingRules(ssrCookie.value) }
  catch { return [] }
})

const newTagName = ref('')
const newRating = ref<Rating>('questionable')

// Tag autocomplete
const suggestions = ref<Tag[]>([])
const showSuggestions = ref(false)
let debounceTimer: ReturnType<typeof setTimeout>

async function onTagInput() {
  if (debounceTimer) clearTimeout(debounceTimer)
  const q = newTagName.value.trim()
  if (!q) { suggestions.value = []; showSuggestions.value = false; return }
  debounceTimer = setTimeout(async () => {
    try {
      suggestions.value = await fetchAutocomplete(q)
      showSuggestions.value = suggestions.value.length > 0
    } catch { suggestions.value = [] }
  }, 250)
}

function selectSuggestion(tag: Tag) {
  newTagName.value = tag.name
  showSuggestions.value = false
}

async function addRule() {
  if (!newTagName.value.trim()) return
  try {
    await createAutoRatingRule(newTagName.value.trim(), newRating.value, ssrCookie.value)
    newTagName.value = ''
    suggestions.value = []
    await refreshNuxtData()
  } catch {
    alert('添加失败')
  }
}

async function removeRule(id: string, tagName: string, targetRating: string) {
  if (!confirm(`确定删除规则 "${tagName}" → ${targetRating}？`)) return
  try {
    await deleteAutoRatingRule(id, ssrCookie.value)
    await refreshNuxtData()
  } catch {
    alert('删除失败')
  }
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <h2 class="text-lg font-bold tracking-tight" style="font-family: var(--font-display);">自动评级规则</h2>
      <p class="text-xs text-[var(--text-muted)] mt-1">当导入的图片包含指定标签时，自动设置评级（仅升级不降级）。</p>
    </div>

    <!-- Add rule -->
    <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 flex items-center gap-3 flex-wrap">
      <div class="relative flex-1 min-w-[180px]">
        <input
          v-model="newTagName"
          type="text"
          placeholder="输入标签名…"
          class="w-full px-3 py-2 rounded-xl border text-sm transition-colors focus:outline-none focus:border-[var(--accent-color)]"
          :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }"
          @input="onTagInput"
          @focus="onTagInput"
          @blur="setTimeout(() => showSuggestions = false, 200)"
        />
        <ul
          v-if="showSuggestions"
          class="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] shadow-xl"
        >
          <li
            v-for="tag in suggestions"
            :key="tag.id"
            @mousedown.prevent="selectSuggestion(tag)"
            class="px-3 py-2 text-sm cursor-pointer transition-colors hover:bg-[var(--accent-subtle)] first:rounded-t-xl last:rounded-b-xl"
          >{{ tag.name }} <span v-if="tag.translation" class="text-[var(--text-muted)] text-xs ml-1">{{ tag.translation }}</span></li>
        </ul>
      </div>
      <select v-model="newRating" class="px-3 py-2 rounded-xl border text-sm transition-colors cursor-pointer focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }">
        <option value="questionable">🟡 敏感</option>
        <option value="explicit">🔴 限制</option>
      </select>
      <button @click="addRule" class="px-4 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95 hover:-translate-y-px" style="background: var(--accent-color); color: var(--bg-primary);">添加</button>
    </div>

    <!-- Rules list -->
    <div v-if="rules && rules.length > 0" class="rounded-2xl border border-[var(--border-color)] overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="border-b border-[var(--border-color)]" style="background: var(--accent-subtle);">
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">标签</th>
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">目标评级</th>
            <th class="text-right px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.id" class="border-b border-[var(--border-color)]/40 transition-colors hover:bg-[var(--accent-subtle)]/50">
            <td class="px-4 py-2.5 font-medium text-sm text-[var(--text-primary)]">{{ rule.tag_name }}</td>
            <td class="px-4 py-2.5">
              <span class="text-[0.625rem] px-2 py-1 rounded-md font-semibold" :class="getRatingColorClass(rule.target_rating)">{{ getRatingLabel(rule.target_rating) }}</span>
            </td>
            <td class="px-4 py-2.5 text-right">
              <button @click="removeRule(rule.id, rule.tag_name, rule.target_rating)" class="inline-flex items-center gap-1 px-2.5 py-1 text-[0.625rem] rounded-lg text-red-400 hover:text-red-500 hover:bg-red-500/10 transition-all">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center mb-2" style="background: var(--accent-subtle);">
        <svg class="w-5 h-5" style="color: var(--accent-color);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008z" /></svg>
      </div>
      <p class="text-sm font-medium">暂无规则</p>
      <p class="text-xs mt-0.5">添加规则以自动为新导入图片分配评级</p>
    </div>
  </div>
</template>
