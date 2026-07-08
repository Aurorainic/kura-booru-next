<script setup lang="ts">
import type { TagCategory } from '~/types'

const { ssrCookie } = useSsrContext()
const route = useRoute()

// Reactive query params
const page = computed(() => Math.max(1, parseInt(route.query.page as string || '1')))
const sort = computed(() => route.query.sort as string || 'count')
const category = computed(() => route.query.category as string | undefined)

const { data } = await useAsyncData(
  () => `tags-${sort.value}-${category.value || 'all'}-${page.value}`,
  async () => {
    try {
      return await fetchTags(category.value as TagCategory | undefined, sort.value, page.value, 100, ssrCookie.value)
    } catch {
      return { items: [], total: 0, page: 1, per_page: 100, total_pages: 0 }
    }
  },
  { watch: [page, sort, category] }
)

const tags = computed(() => data.value?.items || [])
const total = computed(() => data.value?.total || 0)
const totalPages = computed(() => data.value?.total_pages || 0)

const categories = [
  { value: '', label: '全部' },
  { value: 'artist', label: '画师' },
  { value: 'character', label: '角色' },
  { value: 'copyright', label: '作品' },
  { value: 'general', label: '通用' },
  { value: 'meta', label: '元信息' },
]

const maxCount = computed(() => tags.value.length > 0 ? Math.max(...tags.value.map(t => t.post_count)) : 1)
const minCount = computed(() => tags.value.length > 0 ? Math.min(...tags.value.map(t => t.post_count)) : 0)
const countRange = computed(() => maxCount.value - minCount.value || 1)

function tagSize(postCount: number): string {
  const size = 0.75 + ((postCount - minCount.value) / countRange.value) * 1.25
  return `${size}rem`
}

// 5.3 ← / → page navigation (tags list).
function goToPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  navigateTo({ path: '/tags', query: { ...(category.value ? { category: category.value } : {}), sort: sort.value, ...(p > 1 ? { page: String(p) } : {}) } })
}
useKeyboardShortcuts({ onPrevPage: () => goToPage(page.value - 1), onNextPage: () => goToPage(page.value + 1) })
</script>

<template>
  <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 py-6" style="padding-top: var(--space-page-top);">
    <!-- Header -->
    <div class="flex items-end justify-between gap-6 mb-8 flex-wrap">
      <div>
        <h1 class="gradient-text" style="font-size: var(--font-size-display); font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; font-family: var(--font-display); animation: maskWipe var(--duration-display) var(--ease-out) both;">标签</h1>
        <p class="text-[var(--font-size-meta)] text-[var(--text-muted)] mt-1" style="animation: countUp 0.4s var(--ease-out) 0.2s both;">{{ total }} 个标签</p>
      </div>
      <div class="inline-flex items-center bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-[var(--radius-sm)] p-0.5">
        <NuxtLink :to="`/tags?sort=count${category ? `&category=${category}` : ''}`" class="filter-pill px-3 py-1" :class="{ active: sort === 'count' }">数量</NuxtLink>
        <NuxtLink :to="`/tags?sort=name${category ? `&category=${category}` : ''}`" class="filter-pill px-3 py-1" :class="{ active: sort === 'name' }">名称</NuxtLink>
      </div>
    </div>

    <!-- Category filters -->
    <div class="flex items-center gap-4 mb-8 flex-wrap">
      <NuxtLink
        v-for="cat in categories"
        :key="cat.value"
        :to="`/tags?category=${cat.value}&sort=${sort}`"
        class="filter-pill"
        :class="{ active: (category || '') === cat.value }"
      >{{ cat.label }}</NuxtLink>
    </div>

    <!-- Tag constellation (4.4): cloud IS the content — name in display font,
         category color as text color, hover reveals translation + danbooru_name.
         No table; pagination below. -->
    <div v-if="tags.length > 0" class="mb-8" style="animation: pageIn var(--duration-slow) var(--ease-out);">
      <div class="flex flex-wrap gap-x-4 gap-y-3 items-baseline">
        <NuxtLink
          v-for="tag in tags"
          :key="tag.id"
          :to="`/tags/${encodeURIComponent(tag.name)}`"
          class="tag-star group/tag relative inline-block rounded-[var(--radius-sm)] px-1.5 py-0.5 transition-all duration-[var(--duration-fast)] hover:scale-110"
          :style="{
            fontSize: tagSize(tag.post_count),
            color: getTagCategoryVar(tag.category),
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
          }"
        >
          {{ tag.name }}
          <span class="text-[0.625rem] opacity-50 ml-0.5 font-mono tabular-nums">{{ tag.post_count }}</span>
          <!-- Hover tooltip: translation + danbooru_name -->
          <span
            v-if="tag.translation || tag.danbooru_name"
            class="pointer-events-none absolute left-0 top-full mt-1 z-20 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--bg-surface)] border border-[var(--border-color)] px-2 py-1 text-[0.6875rem] font-normal opacity-0 translate-y-1 transition-all duration-[var(--duration-fast)] group-hover/tag:opacity-100 group-hover/tag:translate-y-0"
            style="color: var(--text-muted); font-family: var(--font-body);"
          >
            <template v-if="tag.translation">{{ tag.translation }}</template>
            <template v-if="tag.translation && tag.danbooru_name"> · </template>
            <template v-if="tag.danbooru_name"><span class="font-mono">{{ tag.danbooru_name }}</span></template>
          </span>
        </NuxtLink>
      </div>
    </div>

    <!-- Empty -->
    <div v-else class="flex flex-col items-center justify-center py-24 text-[var(--text-muted)]">
      <p class="text-lg font-semibold mb-1">暂无标签</p>
      <p class="text-sm">添加插画后标签会自动出现</p>
    </div>

    <Pagination v-if="totalPages > 1" :current-page="page" :total-pages="totalPages" :per-page="100" />
  </div>
</template>
