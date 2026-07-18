<script setup lang="ts">
const { ssrCookie } = useSsrContext()
const { data: stats, pending } = await useAsyncData('dashboard', async () => {
  try {
    return await fetchDashboardStats(ssrCookie.value)
  } catch {
    return null
  }
})

const overviewCards = computed(() => {
  if (!stats.value) return []
  const s = stats.value
  return [
    { label: '总图片', value: s.overview.total_posts, icon: 'M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z', delay: 0 },
    { label: '总标签', value: s.overview.total_tags, icon: 'M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z', delay: 1 },
    { label: '标签关联', value: s.overview.total_post_tags, icon: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5', delay: 2 },
    { label: '存储总量', value: formatFileSize(s.overview.total_file_size_bytes), icon: 'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125', delay: 3 },
  ]
})

// ── Pie chart data (来源分布) ──
const SOURCE_COLORS: Record<string, string> = {
  pixiv: '#0096fa', twitter: '#1d9bf0', danbooru: '#e34f32', other: '#8b5cf6',
}
const sourcePie = computed(() => {
  if (!stats.value?.source_breakdown.length) return []
  const items = stats.value.source_breakdown.map(i => ({ ...i, count: Number(i.count) }))
  const total = items.reduce((s, i) => s + i.count, 0)
  let cumulative = 0
  return items.map((item) => {
    const pct = total ? item.count / total : 0
    const start = cumulative
    cumulative += pct
    return { ...item, pct, start, color: SOURCE_COLORS[item.source_site] || '#6366f1', total }
  })
})

function pieSlice(startPct: number, endPct: number, r: number): string {
  if (endPct - startPct >= 0.999) {
    return `M16,${16 - r} A${r},${r} 0 1,1 16,${16 + r} A${r},${r} 0 1,1 16,${16 - r} Z`
  }
  const rad = (p: number) => p * 2 * Math.PI - Math.PI / 2
  const a1 = rad(startPct), a2 = rad(endPct)
  const x1 = 16 + r * Math.cos(a1), y1 = 16 + r * Math.sin(a1)
  const x2 = 16 + r * Math.cos(a2), y2 = 16 + r * Math.sin(a2)
  const large = endPct - startPct > 0.5 ? 1 : 0
  return `M16,16 L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`
}

const ratingPie = computed(() => {
  if (!stats.value?.rating_breakdown.length) return []
  const items = stats.value.rating_breakdown.map(i => ({ ...i, count: Number(i.count) }))
  const total = items.reduce((s, i) => s + i.count, 0)
  let cumulative = 0
  return items.map((item) => {
    const pct = total ? item.count / total : 0
    const start = cumulative
    cumulative += pct
    return { ...item, pct, start, total }
  })
})

// ponytail: rating colors now derived from the same .rating-* CSS classes —
// we read the resolved CSS var so the segmented bar matches the badge palette
// instead of a parallel hardcoded dictionary.
const ratingBg = (rating: string) => {
  const map: Record<string, string> = {
    safe: 'var(--color-success)',
    questionable: 'var(--color-warning)',
    explicit: 'var(--color-danger)',
  }
  return map[rating] || 'var(--accent-color)'
}
</script>

<template>
  <div v-if="pending" class="space-y-5">
    <LoadingCard message="加载仪表盘…" />
  </div>

  <div v-else-if="stats" class="space-y-5">
    <!-- Overview cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div
        v-for="card in overviewCards"
        :key="card.label"
        class="dash-card relative overflow-hidden !p-5 transition-all duration-300 hover:border-[var(--accent-color)]/40 hover:shadow-lg hover:-translate-y-0.5"
        :style="{ animation: `fadeSlideIn 0.4s var(--ease-out) ${card.delay * 80}ms both` }"
      >
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style="background: var(--accent-subtle);">
            <svg class="w-5 h-5" style="color: var(--accent-color);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" :d="card.icon" /></svg>
          </div>
          <span class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-widest">{{ card.label }}</span>
        </div>
        <p class="text-3xl font-bold tabular-nums text-[var(--text-primary)] tracking-tight" style="font-feature-settings: 'tnum';">{{ card.value }}</p>
        <div class="absolute bottom-0 left-0 right-0 h-0.5" style="background: var(--accent-gradient); opacity: 0.6;" />
      </div>
    </div>

    <!-- Source + Rating row — Pie + Segmented Bar -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <!-- Source breakdown — Donut chart -->
      <div class="dash-card !p-5">
        <h3 class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-4">来源分布</h3>
        <div class="flex items-center gap-6">
          <svg v-if="sourcePie.length" viewBox="0 0 32 32" class="w-28 h-28 flex-shrink-0">
            <circle cx="16" cy="16" r="13" fill="none" stroke-width="5" style="stroke: var(--bg-alt);" />
            <path
              v-for="slice in sourcePie"
              :key="slice.source_site"
              :d="pieSlice(slice.start, slice.start + slice.pct, 13)"
              :fill="slice.color"
              :stroke="slice.color"
              stroke-width="0.5"
              class="transition-all duration-500"
              style="opacity: 0.85;"
            />
            <circle cx="16" cy="16" r="7" style="fill: var(--bg-surface);" />
          </svg>
          <div v-else class="w-28 h-28 flex-shrink-0 flex items-center justify-center text-[var(--text-muted)] text-xs">无数据</div>
          <div class="flex-1 space-y-2">
            <div v-for="slice in sourcePie" :key="slice.source_site" class="flex items-center gap-2 text-xs">
              <span class="w-2.5 h-2.5 rounded-sm flex-shrink-0" :style="{ background: slice.color }" />
              <span class="flex-1 text-[var(--text-primary)]">{{ getSourceSiteLabel(slice.source_site) }}</span>
              <span class="font-mono tabular-nums text-[var(--text-muted)]">{{ slice.count }}</span>
              <span class="text-[var(--text-muted)]/60">{{ (slice.pct * 100).toFixed(0) }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Rating breakdown — Segmented bar -->
      <div class="dash-card !p-5">
        <h3 class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-4">评级分布</h3>
        <div class="space-y-3">
          <div v-if="ratingPie.length" class="flex h-5 rounded-full overflow-hidden">
            <div
              v-for="item in ratingPie"
              :key="item.rating"
              :style="{ width: `${item.pct * 100}%`, background: ratingBg(item.rating) }"
              class="transition-all duration-700 ease-out first:rounded-l-full last:rounded-r-full"
              :title="`${getRatingLabel(item.rating)}: ${item.count}`"
            />
          </div>
          <div class="flex items-center gap-5 text-xs">
            <div v-for="item in ratingPie" :key="item.rating" class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-sm flex-shrink-0" :style="{ background: ratingBg(item.rating) }" />
              <span class="text-[var(--text-primary)]">{{ getRatingLabel(item.rating) }}</span>
              <span class="font-mono tabular-nums text-[var(--text-muted)]">{{ item.count }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Top tags -->
    <div class="dash-card !p-5">
      <h3 class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-4">热门标签</h3>
      <div class="flex flex-wrap gap-1.5">
        <NuxtLink
          v-for="tag in stats.top_tags.slice(0, 24)"
          :key="tag.id"
          :to="`/tags/${encodeURIComponent(tag.name)}`"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 hover:-translate-y-px"
          :style="{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }"
          @mouseenter="(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-color)'; (e.currentTarget as HTMLElement).style.background = 'var(--accent-subtle)' }"
          @mouseleave="(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)'; (e.currentTarget as HTMLElement).style.background = '' }"
        >
          <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :style="{ background: getTagCategoryVar(tag.category) }" />
          <span>{{ tag.name }}</span>
          <span class="text-[var(--text-muted)] font-mono text-[0.625rem]">{{ tag.post_count }}</span>
        </NuxtLink>
      </div>
    </div>

    <!-- System status — queue depth now lives in AdminStatusBar (top of page).
         This panel only renders the per-card stats; polling moved to the bar. -->
    <div class="dash-card !p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-widest">系统状态</h3>
        <span class="inline-flex items-center gap-1.5 text-[0.625rem] text-[var(--text-muted)]">
          <span class="w-1.5 h-1.5 rounded-full" style="background: var(--color-success);" />
          系统正常
        </span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="text-center p-4 rounded-xl" style="background: var(--accent-subtle);">
          <p class="text-2xl font-bold tabular-nums" style="font-feature-settings: 'tnum';">{{ stats.overview.total_posts }}</p>
          <p class="text-[0.6875rem] font-medium text-[var(--text-muted)] mt-1">作品总数</p>
        </div>
        <div class="text-center p-4 rounded-xl" style="background: var(--accent-subtle);">
          <p class="text-2xl font-bold tabular-nums" style="font-feature-settings: 'tnum';">{{ stats.overview.total_tags }}</p>
          <p class="text-[0.6875rem] font-medium text-[var(--text-muted)] mt-1">标签总数</p>
        </div>
        <div class="text-center p-4 rounded-xl" style="background: var(--accent-subtle);">
          <p class="text-2xl font-bold tabular-nums" style="font-feature-settings: 'tnum';">{{ stats.overview.total_post_tags }}</p>
          <p class="text-[0.6875rem] font-medium text-[var(--text-muted)] mt-1">关联总数</p>
        </div>
        <div class="text-center p-4 rounded-xl" style="background: var(--accent-subtle);">
          <p class="text-sm font-medium text-[var(--text-muted)]">存储</p>
          <p class="text-xs text-[var(--text-muted)] mt-1">{{ formatFileSize(stats.overview.total_file_size_bytes) }}</p>
        </div>
      </div>
    </div>
  </div>

  <EmptyState
    v-else
    title="无法加载仪表盘"
    description="检查后端服务和数据库连接"
    icon="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
  />
</template>
