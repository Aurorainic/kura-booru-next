<script setup lang="ts">
import type { TagCategory } from '~/types'

const { ssrCookie } = useSsrContext()
const route = useRoute()
const page = Math.max(1, parseInt(route.query.page as string || '1'))
const searchQuery = ref('')
const categoryFilter = ref<TagCategory | ''>('')
const aiStatusFilter = ref<'all' | 'unprocessed' | 'processed'>('all')
const sortKey = ref<'post_count' | 'name' | 'created_at'>('post_count')

const { data, refresh } = await useAsyncData('admin-tags', async () => {
  try {
    return await fetchAdminTags({
      q: searchQuery.value || undefined,
      page,
      per_page: 50,
      category: categoryFilter.value || undefined,
      sort: sortKey.value,
    }, ssrCookie.value)
  } catch {
    return { items: [], total: 0, page: 1, per_page: 50, total_pages: 0 }
  }
})

const tags = computed(() => {
  const items = data.value?.items || []
  // Client-side AI status filter (no backend support yet)
  if (aiStatusFilter.value === 'unprocessed') return items.filter(t => !t.ai_processed_at)
  if (aiStatusFilter.value === 'processed') return items.filter(t => !!t.ai_processed_at)
  return items
})

// Inline editing state
const editingTag = ref<string | null>(null)
const editForm = ref({ category: '', danbooru_name: '', translation: '' })

function startEditing(tag: any) {
  editingTag.value = tag.id
  editForm.value = {
    category: tag.category || 'general',
    danbooru_name: tag.danbooru_name || '',
    translation: tag.translation || '',
  }
}

async function saveTag(tag: any) {
  try {
    await updateAdminTag(tag.id, editForm.value, ssrCookie.value)
    editingTag.value = null
    await refresh()
  } catch (e: any) {
    alert(`保存失败: ${e.message || '未知错误'}`)
  }
}

function cancelEdit() {
  editingTag.value = null
}

// AI reprocess
const reprocessing = ref(false)
async function reprocessTags(mode: 'unprocessed' | 'all') {
  if (reprocessing.value) return
  reprocessing.value = true
  try {
    const result = await reprocessTagsAPI(mode, ssrCookie.value)
    alert(`处理完成: ${result.processed} 成功, ${result.failed} 失败`)
    await refresh()
  } catch (e: any) {
    alert(`重处理失败: ${e.message || '未知错误'}`)
  } finally {
    reprocessing.value = false
  }
}

// Fix artist categories (one-shot, for historical mis-categorized tags)
const fixingArtists = ref(false)
async function fixArtistCategories() {
  if (fixingArtists.value) return
  if (!confirm('将根据 tag_knowledge 和 artist: 前缀修复历史画师标签分类。继续？')) return
  fixingArtists.value = true
  try {
    const result = await fixArtistCategoriesAPI(ssrCookie.value)
    alert(`修复完成: ${result.total_fixed} 个标签已更正为画师分类\n(知识库: ${result.fixed_from_knowledge}, 合并重复: ${result.merged_into_clean}, 原地改名: ${result.renamed_in_place}, 迁移关联: ${result.posts_moved})`)
    await refresh()
  } catch (e: any) {
    alert(`修复失败: ${e.message || '未知错误'}`)
  } finally {
    fixingArtists.value = false
  }
}

// Merge dialog
const showMergeDialog = ref(false)
const mergeSourceId = ref('')
const mergeTargetId = ref('')
const mergeResult = ref<Record<string, any> | null>(null)

async function doMerge() {
  if (!mergeSourceId.value || !mergeTargetId.value) return
  if (mergeSourceId.value === mergeTargetId.value) {
    alert('不能合并到自身')
    return
  }
  try {
    mergeResult.value = await mergeTags(mergeSourceId.value, mergeTargetId.value, ssrCookie.value)
    showMergeDialog.value = false
    mergeSourceId.value = ''
    mergeTargetId.value = ''
    await refresh()
  } catch (e: any) {
    alert(`合并失败: ${e.message}`)
  }
}

const categories: { value: string; label: string }[] = [
  { value: '', label: '全部分类' },
  { value: 'artist', label: '画师' },
  { value: 'character', label: '角色' },
  { value: 'copyright', label: '作品' },
  { value: 'general', label: '通用' },
  { value: 'meta', label: '元信息' },
]

const categoryOptions = [
  { value: 'artist', label: '画师' },
  { value: 'character', label: '角色' },
  { value: 'copyright', label: '作品' },
  { value: 'general', label: '通用' },
  { value: 'meta', label: '元信息' },
]
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-lg font-bold tracking-tight" style="font-family: var(--font-display);">标签管理</h2>
      <div class="flex items-center gap-1.5">
        <button type="button" class="px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95" :class="reprocessing ? 'opacity-60' : ''" :disabled="reprocessing" style="background: var(--accent-color); color: var(--bg-primary);" @click="reprocessTags('unprocessed')">
          {{ reprocessing ? '处理中…' : 'AI 处理未处理' }}
        </button>
        <button type="button" class="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-primary)]/30 transition-all" :disabled="reprocessing" @click="reprocessTags('all')">
          全部重处理
        </button>
        <button type="button" class="px-3 py-1.5 text-xs font-medium rounded-lg border transition-all" :class="fixingArtists ? 'opacity-60' : ''" :disabled="fixingArtists" style="border-color: var(--accent-color)/40; color: var(--accent-color);" @click="fixArtistCategories">
          {{ fixingArtists ? '修复中…' : '修复画师分类' }}
        </button>
        <button type="button" class="px-3 py-1.5 text-xs font-medium rounded-lg border transition-all" style="border-color: var(--accent-color)/40; color: var(--accent-color);" @click="showMergeDialog = true">合并标签</button>
      </div>
    </div>

    <!-- Filters bar -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative flex-1 min-w-[160px] max-w-xs">
        <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
        <input
          v-model="searchQuery"
          type="search"
          placeholder="搜索标签…"
          class="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-color)] transition-colors"
          @keydown.enter.prevent="() => refresh()"
        />
      </div>
      <select v-model="categoryFilter" class="text-xs px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--accent-color)] transition-colors" @change="() => refresh()">
        <option v-for="cat in categories" :key="cat.value" :value="cat.value">{{ cat.label }}</option>
      </select>
      <select v-model="sortKey" class="text-xs px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--accent-color)] transition-colors" @change="() => refresh()">
        <option value="post_count">按数量</option>
        <option value="name">按名称</option>
      </select>
    </div>

    <!-- Table -->
    <div v-if="tags.length > 0" class="rounded-2xl border border-[var(--border-color)] overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="border-b border-[var(--border-color)]" style="background: var(--accent-subtle);">
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">标签</th>
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">分类</th>
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider hidden md:table-cell">Danbooru</th>
            <th class="text-left px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider hidden md:table-cell">翻译</th>
            <th class="text-right px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">数量</th>
            <th class="text-right px-4 py-3 text-[0.625rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tag in tags" :key="tag.id" class="border-b border-[var(--border-color)]/40 transition-colors hover:bg-[var(--accent-subtle)]/50 group">
            <!-- Name -->
            <td class="px-4 py-2.5">
              <div class="flex items-center gap-2">
                <span class="font-medium text-sm text-[var(--text-primary)]">{{ tag.name }}</span>
                <TagIdTooltip :tag-id="tag.id" />
              </div>
            </td>
            <!-- Category (inline editable) -->
            <td class="px-4 py-2.5">
              <template v-if="editingTag === tag.id">
                <select v-model="editForm.category" class="px-2 py-1 text-xs rounded-lg border border-[var(--accent-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none">
                  <option v-for="co in categoryOptions" :key="co.value" :value="co.value">{{ co.label }}</option>
                </select>
              </template>
              <template v-else>
                <span class="text-[0.625rem] px-2 py-1 rounded-md font-medium" :style="{ color: getTagCategoryVar(tag.category), background: `${getTagCategoryVar(tag.category)}15` }">{{ getTagCategoryLabel(tag.category) }}</span>
              </template>
            </td>
            <!-- Danbooru name -->
            <td class="px-4 py-2.5 hidden md:table-cell">
              <template v-if="editingTag === tag.id">
                <input v-model="editForm.danbooru_name" type="text" class="w-full px-2 py-1 text-xs rounded-lg border border-[var(--accent-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none" placeholder="danbooru_name" />
              </template>
              <template v-else>
                <span class="text-xs text-[var(--text-muted)]">{{ tag.danbooru_name || '—' }}</span>
              </template>
            </td>
            <!-- Translation -->
            <td class="px-4 py-2.5 hidden md:table-cell">
              <template v-if="editingTag === tag.id">
                <input v-model="editForm.translation" type="text" class="w-full px-2 py-1 text-xs rounded-lg border border-[var(--accent-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none" placeholder="翻译" />
              </template>
              <template v-else>
                <span class="text-xs text-[var(--text-muted)]">{{ tag.translation || '—' }}</span>
              </template>
            </td>
            <!-- Post count -->
            <td class="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-[var(--text-muted)]">{{ tag.post_count }}</td>
            <!-- Actions -->
            <td class="px-4 py-2.5 text-right">
              <template v-if="editingTag === tag.id">
                <div class="flex items-center justify-end gap-1">
                  <button type="button" class="px-2.5 py-1 text-[0.625rem] font-semibold rounded-lg transition-all active:scale-95" style="background: var(--accent-color); color: var(--bg-primary);" @click="saveTag(tag)">保存</button>
                  <button type="button" class="px-2.5 py-1 text-[0.625rem] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" @click="cancelEdit">取消</button>
                </div>
              </template>
              <template v-else>
                <button type="button" class="px-2.5 py-1 text-[0.625rem] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-subtle)] transition-all" @click="startEditing(tag)">编辑</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty state -->
    <div v-else class="flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
      <div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background: var(--accent-subtle);">
        <svg class="w-6 h-6" style="color: var(--accent-color);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3z" /></svg>
      </div>
      <p class="text-sm font-medium">暂无标签</p>
    </div>

    <!-- Merge dialog -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showMergeDialog" class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.4); backdrop-filter: blur(2px);" @click.self="showMergeDialog = false">
          <div class="bg-[var(--bg-surface)] rounded-2xl p-6 w-[420px] max-w-[90vw] shadow-2xl border border-[var(--border-color)]/50" style="animation: modalZoomIn 0.2s var(--ease-out);">
            <h3 class="text-base font-bold mb-1">合并标签</h3>
            <p class="text-xs text-[var(--text-muted)] mb-5">将源标签的所有关联图片移动到目标标签，然后删除源标签。</p>
            <div class="space-y-3">
              <div>
                <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">源标签 ID（将被删除）</label>
                <input v-model="mergeSourceId" type="text" class="w-full px-3 py-2.5 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono focus:outline-none focus:border-red-400 transition-colors" placeholder="uuid-of-source-tag" />
              </div>
              <div>
                <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">目标标签 ID（保留）</label>
                <input v-model="mergeTargetId" type="text" class="w-full px-3 py-2.5 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--accent-color)] transition-colors" placeholder="uuid-of-target-tag" />
              </div>
            </div>
            <div class="flex justify-end gap-2 mt-5">
              <button type="button" class="px-4 py-2 text-sm rounded-xl border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" @click="showMergeDialog = false">取消</button>
              <button type="button" class="px-5 py-2 text-sm font-semibold rounded-xl transition-all active:scale-95" style="background: var(--accent-color); color: var(--bg-primary);" @click="doMerge">合并标签</button>
            </div>
            <!-- Merge detail feedback -->
            <div v-if="mergeResult" class="mt-4 p-3 rounded-xl text-xs space-y-1" style="background: var(--accent-subtle);">
              <p class="font-semibold text-[var(--text-primary)]">{{ mergeResult.source_tag_name }} → {{ mergeResult.target_tag_name }}</p>
              <p class="text-[var(--text-muted)]">已移动: {{ mergeResult.posts_moved }} · 跳过: {{ mergeResult.posts_skipped }} · 新数量: {{ mergeResult.target_new_post_count }}</p>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
