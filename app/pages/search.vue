<script setup lang="ts">
import type { Tag } from '~/types'

const { isAdmin, ssrCookie } = useSsrContext()
const route = useRoute()

// Reactive query params for watch-driven re-fetch
const query = computed(() => route.query.q as string || '')
const source = computed(() => route.query.source as string || '')
const page = computed(() => Math.max(1, parseInt(route.query.page as string || '1')))
const perPageCookie = useCookie('kura-per-page')
const perPage = computed(() => {
  const param = route.query.per_page as string
  if (param) return clampPerPage(parseInt(param))
  const parsed = perPageCookie.value ? clampPerPage(parseInt(perPageCookie.value)) : NaN
  return isNaN(parsed) ? 40 : parsed
})

const { data } = await useAsyncData(
  () => `search-${query.value}-${source.value}-${page.value}-${perPage.value}`,
  async () => {
    if (!query.value) return emptyPostsResponse()
    try {
      return await fetchSearch(query.value, page.value, perPage.value, ssrCookie.value, source.value || undefined)
    } catch {
      return emptyPostsResponse()
    }
  },
  { watch: [query, source, page, perPage] }
)

const posts = computed(() => data.value?.items || [])
const total = computed(() => data.value?.total || 0)
const totalPages = computed(() => data.value?.total_pages || 0)
const unresolvedTags = computed(() => data.value?.unresolved_tags || [])

const sourceOptions = [
  { value: '', label: '全部' },
  { value: 'pixiv', label: 'Pixiv' },
  { value: 'twitter', label: 'Twitter/X' },
  { value: 'danbooru', label: 'Danbooru' },
]

// 4.5 Search exploration: when no query, surface recent searches (localStorage)
// + popular tags (Top 10 by post_count) to encourage exploration.
const RECENT_KEY = 'kura-recent-searches'
const recentSearches = ref<string[]>([])
const popularTags = ref<Tag[]>([])

function loadRecent() {
  if (!import.meta.client) return
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (raw) recentSearches.value = JSON.parse(raw).filter((s: unknown) => typeof s === 'string').slice(0, 8)
  } catch { /* localStorage unavailable */ }
}

function pushRecent(q: string) {
  if (!import.meta.client) return
  const trimmed = q.trim()
  if (!trimmed) return
  try {
    const next = [trimmed, ...recentSearches.value.filter(s => s !== trimmed)].slice(0, 8)
    recentSearches.value = next
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* ignore */ }
}

onMounted(async () => {
  loadRecent()
  try {
    popularTags.value = await fetchPopularTags(ssrCookie.value)
  } catch {
    popularTags.value = []
  }
})

// Record a search into history whenever the query changes to a non-empty value.
watch(query, (q) => { if (q) pushRecent(q) }, { immediate: false })

// 5.3 ← / → page navigation (search results).
function goToPage(p: number) {
  if (p < 1 || p > totalPages.value) return
  navigateTo({ path: '/search', query: { q: query.value, ...(source.value ? { source: source.value } : {}), ...(p > 1 ? { page: String(p) } : {}), per_page: String(perPage.value) } })
}
useKeyboardShortcuts({ onPrevPage: () => goToPage(page.value - 1), onNextPage: () => goToPage(page.value + 1) })
</script>

<template>
  <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 py-4" style="padding-top: var(--space-page-top);">
    <!-- Compact search header (shown only with an active query; the no-query
         state has its own centered 60% search surface in 4.5) -->
    <div v-if="query" class="mb-4">
      <div class="flex items-center gap-3 mb-3">
        <h1 class="gradient-text flex-shrink-0" style="font-size: 1.25rem; font-weight: 700; font-family: var(--font-display);">搜索</h1>
        <div class="flex-1 max-w-md">
          <SearchBar :initial-query="query" />
        </div>
      </div>
    </div>

    <!-- Source filters -->
    <div v-if="query" class="flex items-center gap-4 mb-4 flex-wrap">
      <span class="text-xs text-[var(--text-muted)]">来源：</span>
      <NuxtLink
        v-for="opt in sourceOptions"
        :key="opt.value"
        :to="`/search?q=${encodeURIComponent(query)}${opt.value ? '&source=' + encodeURIComponent(opt.value) : ''}`"
        class="filter-pill"
        :class="{ active: source === opt.value }"
      >{{ opt.label }}</NuxtLink>
    </div>

    <!-- Unresolved tags warning -->
    <div v-if="unresolvedTags.length > 0" class="mb-4 px-4 py-2.5 rounded-[var(--radius-md)] bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 text-sm text-[var(--text-primary)] flex items-center gap-2">
      <svg class="w-4 h-4 text-[var(--color-warning)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
      </svg>
      <span>未找到标签：<strong>{{ unresolvedTags.join('、') }}</strong></span>
    </div>

    <!-- Empty: no query — exploration surface (4.5) -->
    <div v-if="!query" class="flex flex-col items-center py-10">
      <!-- 60%-width centered search box -->
      <div class="w-full max-w-[60%] min-w-[280px] mb-8">
        <SearchBar :initial-query="query" />
      </div>

      <!-- Syntax hint -->
      <p class="text-sm max-w-[420px] text-center text-[var(--text-muted)] mb-8">
        用 <kbd class="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-color)] font-mono text-xs">+</kbd> 组合，<kbd class="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-color)] font-mono text-xs">-</kbd> 排除，<kbd class="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-color)] font-mono text-xs">source:pixiv</kbd> 筛选来源
      </p>

      <!-- Recent searches (localStorage) -->
      <div v-if="recentSearches.length > 0" class="w-full max-w-2xl mb-8">
        <h2 class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">最近搜索</h2>
        <div class="flex flex-wrap gap-2">
          <NuxtLink
            v-for="s in recentSearches"
            :key="s"
            :to="`/search?q=${encodeURIComponent(s)}`"
            class="filter-pill px-1"
          >{{ s }}</NuxtLink>
        </div>
      </div>

      <!-- Popular tags (DB Top 10) -->
      <div v-if="popularTags.length > 0" class="w-full max-w-2xl">
        <h2 class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">热门标签</h2>
        <div class="flex flex-wrap gap-2">
          <TagBadge
            v-for="tag in popularTags"
            :key="tag.id"
            :tag="tag"
            :show-translation="true"
            :link="true"
          />
        </div>
      </div>
    </div>

    <!-- Results summary -->
    <div v-if="query" class="mb-4">
      <p class="text-sm text-[var(--text-muted)]" style="animation: countUp 0.4s var(--ease-out) 0.2s both;">
        <template v-if="total > 0">找到 <span class="gradient-text font-medium">{{ total }}</span> 个结果</template>
        <template v-else>未找到 "{{ query }}" 的结果</template>
      </p>
    </div>

    <!-- No results -->
    <div v-if="query && posts.length === 0" class="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
      <svg class="w-16 h-16 mb-4 text-[var(--border-color)] opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
      <p class="text-lg font-semibold mb-1">未找到结果</p>
      <p class="text-sm mb-4">尝试其他标签或减少过滤条件</p>
      <NuxtLink to="/search" class="btn-primary">清除搜索</NuxtLink>
    </div>

    <!-- Results grid -->
    <PhotoGrid v-if="posts.length > 0" :posts="posts" :is-admin="isAdmin" />

    <Pagination v-if="totalPages > 1" :current-page="page" :total-pages="totalPages" :per-page="perPage" />
  </div>
</template>
