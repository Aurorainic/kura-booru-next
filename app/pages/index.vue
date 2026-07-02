<script setup lang="ts">
import type { Rating } from '~/types'

const { isAdmin, ssrCookie } = useSsrContext()
const route = useRoute()

// Reactive query params — NuxtLink on same page doesn't re-mount the component,
// so we need watch to re-fetch when the URL changes.
const page = computed(() => Math.max(1, parseInt(route.query.page as string || '1')))
const ratingParam = computed(() => route.query.rating as Rating | null)
const rating = computed(() => isAdmin.value && ratingParam.value ? ratingParam.value : undefined)

const perPageCookie = useCookie('kura-per-page')
const perPage = computed(() => {
  const param = route.query.per_page as string
  if (param) return clampPerPage(parseInt(param))
  const parsed = perPageCookie.value ? clampPerPage(parseInt(perPageCookie.value)) : NaN
  return isNaN(parsed) ? 40 : parsed
})

const { data, error } = await useAsyncData(
  () => `posts-${page.value}-${perPage.value}-${rating.value || 'all'}`,
  async () => {
    try {
      return await fetchPosts(page.value, perPage.value, rating.value, ssrCookie.value)
    } catch {
      return emptyPostsResponse()
    }
  },
  { watch: [page, rating, perPage] }
)

const posts = computed(() => data.value?.items || [])
const total = computed(() => data.value?.total || 0)
const totalPages = computed(() => data.value?.total_pages || 0)

const quickSearch = ref('')

function onQuickSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    const q = quickSearch.value.trim()
    if (q) navigateTo(`/search?q=${encodeURIComponent(q)}`)
  }
}

const ratingFilters = [
  { value: '', label: '全部' },
  { value: 'safe', label: '公开' },
  { value: 'questionable', label: '敏感' },
  { value: 'explicit', label: '限制' },
]
</script>

<template>
  <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 py-6" style="padding-top: var(--space-page-top);">
    <!-- Header -->
    <div class="flex items-end justify-between gap-6 mb-8 flex-wrap">
      <div>
        <h1 class="gradient-text" style="font-size: var(--font-size-display); font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; font-family: var(--font-display); animation: maskWipe var(--duration-display) var(--ease-out) both;">
          画廊
        </h1>
        <p class="text-[var(--font-size-meta)] text-[var(--text-muted)] mt-1" style="animation: countUp 0.4s var(--ease-out) 0.2s both;">
          {{ total }} 张插画
        </p>
      </div>

      <!-- Rating filters (admin only) -->
      <div v-if="isAdmin" class="flex items-center gap-4 flex-wrap">
        <NuxtLink
          v-for="f in ratingFilters"
          :key="f.value"
          :to="f.value ? `/?rating=${f.value}` : '/'"
          class="filter-pill"
          :class="{ active: (rating || '') === f.value }"
        >{{ f.label }}</NuxtLink>
      </div>
    </div>

    <!-- Quick search -->
    <div class="relative max-w-sm mb-6">
      <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
      <input
        v-model="quickSearch"
        type="search"
        placeholder="搜索标签...(用 + 组合，用 - 排除)"
        class="w-full py-1.5 pl-9 pr-8 rounded-[var(--radius-full)] border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-[0.875rem] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-color)] focus:ring-2 focus:ring-[var(--accent-subtle)] transition-all"
        @keydown="onQuickSearchKeydown"
      />
    </div>

    <!-- Masonry grid -->
    <PhotoGrid v-if="posts.length > 0" :posts="posts" :is-admin="isAdmin" />

    <!-- Empty state -->
    <div v-else class="flex flex-col items-center justify-center py-24 text-[var(--text-muted)]">
      <svg class="w-16 h-16 mb-4 text-[var(--border-color)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
      </svg>
      <p class="text-lg font-semibold mb-1">暂无插画</p>
      <p class="text-sm">通过 Telegram 机器人发送图片来开始</p>
    </div>

    <!-- Pagination -->
    <Pagination v-if="totalPages > 0" :current-page="page" :total-pages="totalPages" :per-page="perPage" />
  </div>
</template>
