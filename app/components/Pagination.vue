<script setup lang="ts">
const props = withDefaults(defineProps<{
  currentPage: number
  totalPages: number
  perPage: number
}>(), {
  currentPage: 1,
  totalPages: 1,
  perPage: 40,
})

const PER_PAGE_OPTIONS = [20, 40, 100]
const PER_PAGE_COOKIE_KEY = 'kura-per-page'
const perPageCookie = useCookie(PER_PAGE_COOKIE_KEY, { sameSite: 'lax' })
const jumpPage = ref(props.currentPage)

watch(() => props.currentPage, (value) => {
  jumpPage.value = value
})

const pages = computed(() => {
  const total = props.totalPages
  const current = props.currentPage
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

const route = useRoute()

function pageUrl(page: number): string {
  if (import.meta.client) {
    const url = new URL(window.location.href)
    if (page === 1) {
      url.searchParams.delete('page')
    } else {
      url.searchParams.set('page', String(page))
    }
    url.searchParams.set('per_page', String(props.perPage))
    return url.pathname + '?' + url.searchParams.toString()
  }
  // ponytail: SSR — useRoute().path is deterministic unlike useRequestURL()
  // which can have inconsistent pathname behavior in certain SSR edge cases.
  const params = new URLSearchParams()
  if (page > 1) params.set('page', String(page))
  params.set('per_page', String(props.perPage))
  // Append any existing query params from the route
  const routeQuery = route.query
  for (const [k, v] of Object.entries(routeQuery)) {
    if (k !== 'page' && k !== 'per_page' && v !== undefined) {
      params.set(k, String(v))
    }
  }
  return route.path + '?' + params.toString()
}

function changePerPage(value: number) {
  perPageCookie.value = String(value)
  if (import.meta.client) {
    const url = new URL(window.location.href)
    url.searchParams.set('page', '1')
    url.searchParams.set('per_page', String(value))
    navigateTo(url.pathname + '?' + url.searchParams.toString())
  }
}

function goToJumpPage() {
  const target = Math.floor(Number(jumpPage.value))
  if (!Number.isFinite(target)) return
  const clamped = Math.min(Math.max(target, 1), props.totalPages)
  jumpPage.value = clamped
  if (clamped !== props.currentPage) {
    navigateTo(pageUrl(clamped))
  }
}
</script>

<template>
  <nav class="flex flex-wrap items-center justify-between gap-4 mt-8 pt-6 border-t border-[var(--border-color)]">
    <!-- Page navigation -->
    <div v-if="totalPages > 1" class="flex items-center gap-1">
      <!-- Previous -->
      <NuxtLink
        v-if="currentPage > 1"
        :to="pageUrl(currentPage - 1)"
        rel="prev"
        class="page-btn active:scale-[0.92]"
        aria-label="上一页"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
      </NuxtLink>
      <span v-else class="page-btn page-btn-disabled">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
      </span>

      <!-- Page numbers -->
      <template v-for="(p, i) in pages" :key="i">
        <span v-if="p === '...'" class="text-[var(--text-muted)] text-sm px-1 select-none">…</span>
        <NuxtLink
          v-else
          :to="pageUrl(p as number)"
          class="page-num active:scale-[0.92]"
          :class="{ active: p === currentPage }"
          :aria-current="p === currentPage ? 'page' : undefined"
          :aria-label="`第 ${p} 页`"
        >{{ p }}</NuxtLink>
      </template>

      <!-- Next -->
      <NuxtLink
        v-if="currentPage < totalPages"
        :to="pageUrl(currentPage + 1)"
        rel="next"
        class="page-btn active:scale-[0.92]"
        aria-label="下一页"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
      </NuxtLink>
      <span v-else class="page-btn page-btn-disabled">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
      </span>
    </div>

    <!-- Jump to page -->
    <form
      v-if="totalPages > 1"
      class="flex items-center gap-1.5"
      @submit.prevent="goToJumpPage"
    >
      <label for="pagination-jump" class="text-xs text-[var(--text-muted)] flex-shrink-0">跳转</label>
      <input
        id="pagination-jump"
        v-model.number="jumpPage"
        type="number"
        min="1"
        :max="totalPages"
        class="w-16 h-8 px-2 text-center text-sm rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-color)]"
        aria-label="跳转到第几页"
      />
      <button
        type="submit"
        class="h-8 px-2 rounded-[var(--radius-sm)] inline-flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent-color)] hover:bg-[var(--accent-subtle)] transition-colors"
        aria-label="跳转"
      >
        <span>页</span>
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
      </button>
    </form>

    <!-- Per-page selector -->
    <div class="flex items-center gap-2 flex-shrink-0">
      <svg class="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
      <select
        :value="perPage"
        @change="changePerPage(Number(($event.target as HTMLSelectElement).value))"
        class="page-select"
      >
        <option v-for="opt in PER_PAGE_OPTIONS" :key="opt" :value="opt">{{ opt }}/页</option>
      </select>
    </div>
  </nav>
</template>
