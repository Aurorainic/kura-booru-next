import type { RouterConfig } from '@nuxt/kit'

// Scroll position memory: store scrollY per from.path in sessionStorage,
// restore on back/forward navigation. Forward navigation scrolls to top.
// Keyed on `path` (not `fullPath`): the detail page's back button rebuilds
// the gallery URL with only `?page=N`, dropping the `from`/`list` helpers,
// so a fullPath key would miss the restore. Path-only survives that rewrite.
const SCROLL_KEY_PREFIX = 'kura-scroll:'
const SCROLL_TTL_MS = 1000 * 60 * 30 // ponytail: bound sessionStorage growth; back-nav is usually < 30m

interface ScrollEntry { y: number; t: number }

function saveScroll(path: string, y: number) {
  try {
    sessionStorage.setItem(SCROLL_KEY_PREFIX + path, JSON.stringify({ y, t: Date.now() } satisfies ScrollEntry))
  } catch { /* sessionStorage may be unavailable (private mode) */ }
}

function readScroll(path: string): number | null {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY_PREFIX + path)
    if (!raw) return null
    const entry = JSON.parse(raw) as ScrollEntry
    if (Date.now() - entry.t > SCROLL_TTL_MS) {
      sessionStorage.removeItem(SCROLL_KEY_PREFIX + path)
      return null
    }
    return Number.isNaN(entry.y) ? null : entry.y
  } catch { return null }
}

// Restore after the DOM has settled. Masonry columns + aspect-ratio image
// placeholders shift layout as images stream in; restoring on nextTick alone
// races that reflow and clamps to a too-short page.
//
// We do the scrolling ourselves via rAF and only `resolve` once the target is
// reached (or it's unreachable on a short page, or the 1s ceiling hits). This
// matters because vue-router's `handleScroll` awaits the Promise returned by
// `scrollBehavior`, then itself calls `scrollToPosition` on the resolved
// value — if we resolved synchronously, vue-router would scrollTo the same
// short page in parallel with our rAF and the two would fight. Returning
// `false` once we've handled the scroll tells vue-router to skip its own
// `scrollToPosition` (falsy position → no-op), so there's exactly one writer.
function restoreWhenSettled(targetY: number): Promise<false> {
  return new Promise<false>((resolve) => {
    nextTick(() => {
      const start = Date.now()
      const tick = () => {
        window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior })
        // Done if: (a) we reached the target, (b) the page is too short to
        // ever hold targetY (short-page / all-images-cached case — don't spin
        // the full second), or (c) the 1s ceiling as a backstop.
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight
        const reachable = maxScroll >= targetY - 1
        if (window.scrollY >= targetY - 1 || !reachable || Date.now() - start > 1000) {
          resolve(false)
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  })
}

export default <RouterConfig>{
  scrollBehavior(to, from, savedPosition) {
    // Browser back/forward with a saved position — use it directly.
    if (savedPosition) {
      return savedPosition
    }

    // No `from` (initial entry) — top.
    if (!from || from.path === to.path) {
      return { top: 0 }
    }

    if (import.meta.client) {
      // Save the outgoing page's scroll offset keyed by path, so the detail
      // page's back button (which rewrites the gallery URL to ?page=N) can
      // still find it.
      saveScroll(from.path, window.scrollY)

      const target = readScroll(to.path)
      if (target !== null) {
        return restoreWhenSettled(target)
      }
    }

    return { top: 0 }
  },
}
