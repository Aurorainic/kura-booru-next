<script setup lang="ts">
import type { TagCategory } from '~/types'

const { ssrCookie } = useSsrContext()
const route = useRoute()
const page = Math.max(1, parseInt(route.query.page as string || '1'))
const toast = useToast()
const confirm = useConfirm()

const searchQuery = ref((route.query.q as string) || '')
const categoryFilter = ref<TagCategory | ''>((route.query.category as TagCategory | '') || '')
const aiStatusFilter = ref<'all' | 'unprocessed' | 'processed'>(((route.query.ai_status as any) || 'all'))
const sortKey = ref<'post_count' | 'name' | 'created_at'>(((route.query.sort as any) || 'post_count'))

async function refetch() {
  try {
    return await fetchAdminTags({
      q: searchQuery.value || undefined,
      page,
      per_page: 50,
      category: categoryFilter.value || undefined,
      ai_status: aiStatusFilter.value === 'all' ? undefined : aiStatusFilter.value,
      sort: sortKey.value,
    }, ssrCookie.value)
  } catch {
    return { items: [], total: 0, page: 1, per_page: 50, total_pages: 0 }
  }
}

const { data, refresh } = await useAsyncData('admin-tags', refetch)

const tags = computed(() => data.value?.items || [])

watch([searchQuery, categoryFilter, aiStatusFilter, sortKey], () => {
  const next: Record<string, string> = {}
  if (searchQuery.value) next.q = searchQuery.value
  if (categoryFilter.value) next.category = categoryFilter.value
  if (aiStatusFilter.value !== 'all') next.ai_status = aiStatusFilter.value
  if (sortKey.value !== 'post_count') next.sort = sortKey.value
  if (page > 1) next.page = String(page)
  navigateTo({ path: route.path, query: next }, { replace: true })
})

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
    toast.success('标签已保存')
  } catch (e: any) {
    toast.error(`保存失败: ${e.message || '未知错误'}`)
  }
}

function cancelEdit() {
  editingTag.value = null
}

const reprocessing = ref(false)
async function reprocessTags(mode: 'unprocessed' | 'all') {
  if (reprocessing.value) return
  reprocessing.value = true
  try {
    const result = await reprocessTagsAPI(mode, ssrCookie.value)
    toast.success(`处理完成: ${result.processed} 成功, ${result.failed} 失败`)
    await refresh()
  } catch (e: any) {
    toast.error(`重处理失败: ${e.message || '未知错误'}`)
  } finally {
    reprocessing.value = false
  }
}

const fixingArtists = ref(false)
async function fixArtistCategories() {
  if (fixingArtists.value) return
  if (!await confirm.ask({
    message: '将根据 tag_knowledge 和 artist: 前缀修复历史画师标签分类。继续？',
    title: '修复画师分类',
    confirmLabel: '继续',
  })) return
  fixingArtists.value = true
  try {
    const result = await fixArtistCategoriesAPI(ssrCookie.value)
    toast.success(`修复完成: ${result.total_fixed} 个标签已更正为画师分类\n(知识库: ${result.fixed_from_knowledge}, 合并重复: ${result.merged_into_clean}, 原地改名: ${result.renamed_in_place}, 迁移关联: ${result.posts_moved})`)
    await refresh()
  } catch (e: any) {
    toast.error(`修复失败: ${e.message || '未知错误'}`)
  } finally {
    fixingArtists.value = false
  }
}

const showMergeDialog = ref(false)
const mergeSourceId = ref('')
const mergeTargetId = ref('')
const mergeResult = ref<Record<string, any> | null>(null)

async function doMerge() {
  if (!mergeSourceId.value || !mergeTargetId.value) return
  if (mergeSourceId.value === mergeTargetId.value) {
    toast.error('不能合并到自身')
    return
  }
  try {
    mergeResult.value = await mergeTags(mergeSourceId.value, mergeTargetId.value, ssrCookie.value)
    showMergeDialog.value = false
    mergeSourceId.value = ''
    mergeTargetId.value = ''
    toast.success('合并完成')
    await refresh()
  } catch (e: any) {
    toast.error(`合并失败: ${e.message}`)
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
    <PageHeader title="标签管理">
      <template #actions>
        <button type="button" class="btn-primary !text-xs !px-3 !py-1.5" :disabled="reprocessing" @click="reprocessTags('unprocessed')">
          {{ reprocessing ? '处理中…' : 'AI 处理未处理' }}
        </button>
        <button type="button" class="btn-ghost !text-xs !px-3 !py-1.5" :disabled="reprocessing" @click="reprocessTags('all')">
          全部重处理
        </button>
        <button type="button" class="btn-ghost !text-xs !px-3 !py-1.5" :disabled="fixingArtists" @click="fixArtistCategories">
          {{ fixingArtists ? '修复中…' : '修复画师分类' }}
        </button>
        <button type="button" class="btn-ghost !text-xs !px-3 !py-1.5" @click="showMergeDialog = true">合并标签</button>
      </template>
    </PageHeader>

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
            <td class="px-4 py-2.5">
              <div class="flex items-center gap-2">
                <span class="font-medium text-sm text-[var(--text-primary)]">{{ tag.name }}</span>
                <TagIdTooltip :tag-id="tag.id" />
              </div>
            </td>
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
            <td class="px-4 py-2.5 hidden md:table-cell">
              <template v-if="editingTag === tag.id">
                <input v-model="editForm.danbooru_name" type="text" class="w-full px-2 py-1 text-xs rounded-lg border border-[var(--accent-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none" placeholder="danbooru_name" />
              </template>
              <template v-else>
                <span class="text-xs text-[var(--text-muted)]">{{ tag.danbooru_name || '—' }}</span>
              </template>
            </td>
            <td class="px-4 py-2.5 hidden md:table-cell">
              <template v-if="editingTag === tag.id">
                <input v-model="editForm.translation" type="text" class="w-full px-2 py-1 text-xs rounded-lg border border-[var(--accent-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none" placeholder="翻译" />
              </template>
              <template v-else>
                <span class="text-xs text-[var(--text-muted)]">{{ tag.translation || '—' }}</span>
              </template>
            </td>
            <td class="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-[var(--text-muted)]">{{ tag.post_count }}</td>
            <td class="px-4 py-2.5 text-right">
              <template v-if="editingTag === tag.id">
                <div class="flex items-center justify-end gap-1">
                  <button type="button" class="btn-primary !text-[0.625rem] !px-2.5 !py-1" @click="saveTag(tag)">保存</button>
                  <button type="button" class="btn-ghost !text-[0.625rem] !px-2.5 !py-1" @click="cancelEdit">取消</button>
                </div>
              </template>
              <template v-else>
                <button type="button" class="btn-ghost !text-[0.625rem] !px-2.5 !py-1" @click="startEditing(tag)">编辑</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <EmptyState
      v-else
      title="暂无标签"
      description="调整搜索或筛选条件"
    />

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
              <button type="button" class="btn-ghost !px-4 !py-2 !text-sm" @click="showMergeDialog = false">取消</button>
              <button type="button" class="btn-primary !px-5 !py-2 !text-sm" @click="doMerge">合并标签</button>
            </div>
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
