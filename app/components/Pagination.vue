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
const perPageCookie = useCookie(PER_PAGE_COOKIE_KEY)

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
  // ponytail: SSR fallback — useRequestURL for server-side
  const reqUrl = useRequestURL()
  const params = new URLSearchParams(reqUrl.search)
  if (page === 1) {
    params.delete('page')
  } else {
    params.set('page', String(page))
  }
  params.set('per_page', String(props.perPage))
  return reqUrl.pathname + '?' + params.toString()
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
</script>

<template>
  <nav class="flex items-center justify-between gap-4 mt-8 pt-6 border-t border-[var(--border-color)]">
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

    <!-- Per-page selector -->
    <div class="flex items-center gap-2">
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
