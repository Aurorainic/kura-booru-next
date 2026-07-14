<script setup lang="ts">
/**
 * Series navigation for multi-image posts (v0.7.8 PR-C).
 *
 * Renders the horizontal thumbnail strip below the main image:
 *   - "1 / 5" counter on the left.
 *   - Thumbnails ordered by page_index 1..N.
 *   - Current page highlighted.
 *   - Click a thumb to navigate to that post's detail page.
 *   - Admin only: × button per thumb to delete that post from the series
 *     (calls /api/admin/posts/[id] DELETE; the row is hard-deleted and
 *     remaining rows renumber contiguously).
 *
 * Number keys 1..9 jump to that page when the focus isn't on a form
 * field (no global keyboard handler needed — we listen here so detail
 * pages without series get nothing).
 */
import type { Post } from '~/types'

const props = defineProps<{
  series: NonNullable<Post['series']>
  currentPostId: string
  isAdmin?: boolean
}>()

const router = useRouter()
const route = useRoute()

const currentPageIndex = computed(() => {
  const match = props.series.pages.find(p => p.id === props.currentPostId)
  return match?.page_index ?? null
})

function goto(pageId: string) {
  if (pageId === props.currentPostId) return
  // ponytail: preserve from + page query params so back-navigation lands
  // the user on their original gallery location (existing detail-page
  // behavior). Without this, hitting a sibling thumb would lose context.
  router.push({ path: `/posts/${pageId}`, query: route.query })
}

const deleting = ref<Record<number, boolean>>({})

async function deletePage(pageId: string, pageIndex: number) {
  if (deleting.value[pageIndex]) return
  if (!confirm(`删除第 ${pageIndex} 张？该系列剩余图将重新编号为 1..N-1。`)) return
  deleting.value = { ...deleting.value, [pageIndex]: true }
  try {
    await deletePost(pageId)
    // After delete the server renumbered page_index for the remaining
    // survivors. Reload the detail page so both the counter and the
    // thumbs strip reflect reality.
    // ponytail: hard reload avoids stale state — the series.pages we
    // have here is wrong (missing the just-deleted row) and updating it
    // client-side would re-implement the server's reorder logic.
    window.location.reload()
  } catch (e) {
    console.error('series delete failed:', e)
    alert('删除失败')
    deleting.value = { ...deleting.value, [pageIndex]: false }
  }
}

function onKey(e: KeyboardEvent) {
  // Skip when typing in form fields — matches useKeyboardShortcuts policy.
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if ((e.target as HTMLElement | null)?.isContentEditable) return
  const idx = parseInt(e.key, 10)
  if (Number.isInteger(idx) && idx >= 1 && idx <= props.series.pages.length) {
    e.preventDefault()
    const page = props.series.pages[idx - 1]
    if (page) goto(page.id)
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="flex items-center gap-2 mt-3 select-none">
    <span class="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">
      {{ currentPageIndex ?? '?' }} / {{ series.page_count }}
    </span>
    <div class="flex gap-1 overflow-x-auto pb-1 flex-1">
      <div
        v-for="p in series.pages"
        :key="p.id"
        class="relative group/series-thumb flex-shrink-0"
      >
        <button
          type="button"
          :aria-label="`第 ${p.page_index} 张`"
          class="block rounded-[var(--radius-sm)] overflow-hidden border-2 transition-colors"
          :class="p.id === currentPostId
            ? 'border-[var(--accent-color)] shadow-sm'
            : 'border-transparent hover:border-[var(--accent-color)]/40'"
          @click="goto(p.id)"
        >
          <img
            :src="getImageUrl(p.thumb_key)"
            :alt="`第 ${p.page_index} 张`"
            class="block w-12 h-12 object-cover"
            loading="lazy"
          />
        </button>
        <!-- Admin: × overlay per thumb -->
        <button
          v-if="isAdmin && p.id !== currentPostId"
          type="button"
          :aria-label="`删除第 ${p.page_index} 张`"
          class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-danger)] text-white text-[0.6rem] flex items-center justify-center opacity-0 group-hover/series-thumb:opacity-100 transition-opacity"
          :disabled="deleting[p.page_index]"
          @click.stop="deletePage(p.id, p.page_index)"
        >×</button>
      </div>
    </div>
  </div>
</template>
