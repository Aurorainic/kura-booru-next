<script setup lang="ts">
import type { Post, Rating, SourceSite } from '~/types'

const { ssrCookie } = useSsrContext()
const route = useRoute()
const toast = useToast()
const confirm = useConfirm()

// Rating filter — uses .rating-* classes for color, no hardcoded hex.
const ratingFilter = ref<string>('')
const ratings: { value: string; label: string; rating?: Rating }[] = [
  { value: '', label: '全部' },
  { value: 'safe', label: '公开', rating: 'safe' },
  { value: 'questionable', label: '敏感', rating: 'questionable' },
  { value: 'explicit', label: '限制', rating: 'explicit' },
]
const sourceSites: { value: SourceSite; label: string }[] = [
  { value: 'pixiv', label: 'Pixiv' },
  { value: 'twitter', label: 'Twitter/X' },
  { value: 'danbooru', label: 'Danbooru' },
  { value: 'other', label: '其他' },
]

const page = computed(() => Number(route.query.p) || 1)
const perPage = ref(40)

const { data, refresh, pending } = await useAsyncData(
  () => `admin-posts-${page.value}-${perPage.value}-${ratingFilter.value}`,
  () => fetchAdminPosts({ page: page.value, per_page: perPage.value, rating: ratingFilter.value || undefined }, ssrCookie.value),
  { watch: [page, perPage, ratingFilter] },
)

const posts = computed(() => data.value?.items || [])
const total = computed(() => data.value?.total || 0)
const totalPages = computed(() => Math.ceil(total.value / perPage.value))

// Ellipsis-based pagination (same pattern as Pagination.vue)
const pages = computed(() => {
  const total = totalPages.value
  const current = page.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const result: (number | '...')[] = [1]
  if (current > 3) result.push('...')
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let i = start; i <= end; i++) result.push(i)
  if (current < total - 2) result.push('...')
  result.push(total)
  return result
})

const saving = ref<Set<string>>(new Set())
async function updateRating(post: Post, newRating: string) {
  if (newRating === post.rating) return
  saving.value.add(post.id)
  try {
    await updatePostRating(post.id, newRating as Rating)
    post.rating = newRating as Rating
    toast.success('评级已更新')
  } catch {
    toast.error('评级更新失败')
  } finally {
    saving.value.delete(post.id)
  }
}

const savingSource = ref<Set<string>>(new Set())
async function updateSource(post: Post, newSource: string) {
  if (newSource === post.source_site) return
  savingSource.value.add(post.id)
  try {
    await updatePostSource(post.id, newSource as SourceSite)
    post.source_site = newSource as SourceSite
    toast.success('来源已更新')
  } catch {
    toast.error('来源更新失败')
  } finally {
    savingSource.value.delete(post.id)
  }
}

const deleting = ref<Set<string>>(new Set())
async function deletePostAction(post: Post) {
  if (!await confirm.ask({
    message: `确定删除该作品？\n${post.title || post.id}`,
    title: '删除作品',
    danger: true,
    confirmLabel: '删除',
  })) return
  deleting.value.add(post.id)
  try {
    await deletePost(post.id)
    await refresh()
    toast.success('作品已删除')
  } catch (e: any) {
    toast.error(`删除失败 (${e.status || '网络错误'})`)
  } finally {
    deleting.value.delete(post.id)
  }
}

function goPage(p: number) {
  navigateTo(`/admin?tab=posts&p=${p}`)
}
</script>

<template>
  <div class="space-y-4">
    <PageHeader title="图片管理">
      <template #actions>
        <select v-model="perPage" class="text-xs px-3 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--accent-color)]">
          <option :value="20">20 条/页</option>
          <option :value="40">40 条/页</option>
          <option :value="100">100 条/页</option>
        </select>
        <NuxtLink to="/admin/import" class="btn-primary !text-xs !px-3 !py-1.5">批量导入</NuxtLink>
      </template>
    </PageHeader>

    <div class="flex items-center gap-1.5 flex-wrap">
      <button
        v-for="r in ratings" :key="r.value"
        @click="ratingFilter = r.value; goPage(1)"
        class="px-3 py-1.5 text-xs font-medium rounded-full border transition-all duration-200 hover:-translate-y-px"
        :class="[
          ratingFilter === r.value && r.rating ? `${getRatingColorClass(r.rating)} border-transparent` : '',
          ratingFilter === r.value && !r.rating ? 'text-white border-transparent' : '',
          ratingFilter !== r.value ? 'border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--text-primary)]' : '',
        ]"
        :style="ratingFilter === r.value && !r.rating ? { background: 'var(--accent-color)' } : {}"
      >{{ r.label }}</button>
    </div>

    <LoadingCard v-if="pending" message="加载图片…" />

    <template v-else>
      <div v-if="posts.length > 0" class="hidden md:block rounded-2xl border border-[var(--border-color)] overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--border-color)]" style="background: var(--accent-subtle);">
              <th class="py-2 px-3 text-left text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">缩略图</th>
              <th class="py-2 px-3 text-left text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">标题</th>
              <th class="py-2 px-3 text-left text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">来源</th>
              <th class="py-2 px-3 text-left text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">评级</th>
              <th class="py-2 px-3 text-left text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">尺寸</th>
              <th class="py-2 px-3 text-left text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider hidden lg:table-cell">日期</th>
              <th class="py-2 px-3 text-right text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="post in posts" :key="post.id"
              class="border-b border-[var(--border-color)]/50 transition-colors hover:bg-[var(--accent-subtle)]/50 group"
            >
              <td class="py-1.5 px-3">
                <NuxtLink :to="`/posts/${post.id}`" class="block w-12 h-12">
                  <img
                    :src="`/i/${post.thumb_key}`"
                    :alt="post.title || ''"
                    class="w-full h-full object-cover rounded-lg transition-transform duration-200 group-hover:scale-105"
                    loading="lazy"
                  />
                </NuxtLink>
              </td>
              <td class="py-1.5 px-3 font-medium text-[var(--text-primary)]">
                <div class="max-w-[180px] truncate" :title="post.title || ''">{{ post.title || '(无标题)' }}</div>
              </td>
              <td class="py-1.5 px-3">
                <select
                  :value="post.source_site"
                  @change="updateSource(post, ($event.target as HTMLSelectElement).value)"
                  class="text-xs px-2 py-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--accent-color)]"
                  :disabled="savingSource.has(post.id)"
                  :title="savingSource.has(post.id) ? '来源更新中…' : '修改来源'"
                >
                  <option v-for="s in sourceSites" :key="s.value" :value="s.value">{{ s.label }}</option>
                </select>
              </td>
              <td class="py-1.5 px-3">
                <select
                  :value="post.rating"
                  @change="updateRating(post, ($event.target as HTMLSelectElement).value)"
                  class="text-xs px-2 py-1 rounded-lg border transition-colors cursor-pointer focus:outline-none focus:border-[var(--accent-color)]"
                  :class="getRatingColorClass(post.rating)"
                  style="background: var(--bg-surface);"
                  :disabled="saving.has(post.id)"
                >
                  <option value="safe">公开</option>
                  <option value="questionable">敏感</option>
                  <option value="explicit">限制</option>
                </select>
              </td>
              <td class="py-1.5 px-3 text-xs font-mono text-[var(--text-muted)]">{{ post.width }}×{{ post.height }}</td>
              <td class="py-1.5 px-3 text-xs text-[var(--text-muted)] hidden lg:table-cell">{{ new Date(post.created_at).toLocaleDateString('zh-CN') }}</td>
              <td class="py-1.5 px-3 text-right">
                <button
                  @click="deletePostAction(post)"
                  class="btn-danger !w-8 !h-8 !px-0 !py-0 !justify-center"
                  :disabled="deleting.has(post.id)"
                  :title="deleting.has(post.id) ? '删除中…' : '删除'"
                >
                  <svg v-if="!deleting.has(post.id)" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                  <svg v-else class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" /></svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="posts.length > 0" class="md:hidden space-y-2">
        <div v-for="post in posts" :key="post.id" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3 flex gap-3 transition-all hover:border-[var(--accent-color)]/30">
          <NuxtLink :to="`/posts/${post.id}`" class="flex-shrink-0 w-16 h-16">
            <img :src="`/i/${post.thumb_key}`" class="w-full h-full object-cover rounded-lg" loading="lazy" />
          </NuxtLink>
          <div class="flex-1 min-w-0 space-y-1">
            <div class="text-sm font-medium truncate text-[var(--text-primary)]">{{ post.title || '(无标题)' }}</div>
            <div class="flex items-center gap-2 text-[0.625rem] text-[var(--text-muted)]">
              <select
                :value="post.source_site"
                @change="updateSource(post, ($event.target as HTMLSelectElement).value)"
                class="text-[0.625rem] px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                :disabled="savingSource.has(post.id)"
              >
                <option v-for="s in sourceSites" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
              <span>{{ post.width }}×{{ post.height }}</span>
            </div>
            <div class="flex items-center gap-2">
              <select
                :value="post.rating"
                @change="updateRating(post, ($event.target as HTMLSelectElement).value)"
                class="text-xs px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                :disabled="saving.has(post.id)"
              >
                <option value="safe">公开</option>
                <option value="questionable">敏感</option>
                <option value="explicit">限制</option>
              </select>
              <button
                @click="deletePostAction(post)"
                class="btn-danger ml-auto !text-sm !px-2 !py-0.5"
                :disabled="deleting.has(post.id)"
              >{{ deleting.has(post.id) ? '…' : '删除' }}</button>
            </div>
          </div>
        </div>
      </div>

      <EmptyState
        v-if="posts.length === 0"
        title="暂无图片"
        description="尝试调整筛选条件或导入新作品"
        icon="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"
      />

      <div v-if="totalPages > 1" class="flex items-center justify-center gap-1 pt-2">
        <template v-for="(p, i) in pages" :key="i">
          <span v-if="p === '...'" class="text-[var(--text-muted)] text-sm px-1 select-none">…</span>
          <button
            v-else
            @click="goPage(p as number)"
            class="w-8 h-8 text-xs rounded-lg transition-all font-medium"
            :class="p === page ? 'text-white' : 'text-[var(--text-muted)] hover:bg-[var(--accent-subtle)]'"
            :style="p === page ? { background: 'var(--accent-color)' } : {}"
            :aria-current="p === page ? 'page' : undefined"
            :aria-label="`第 ${p} 页`"
          >{{ p }}</button>
        </template>
      </div>
    </template>
  </div>
</template>
