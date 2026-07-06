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
// races that reflow and clamps to a too-short page. Poll until the document
// height covers the target (or a short timeout), then jump without animation.
function restoreWhenSettled(targetY: number): Promise<{ top: number; behavior: ScrollBehavior }> {
  return new Promise((resolve) => {
    const tryScroll = () => {
      window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior })
    }
    // ponytail: masonry columns + aspect-ratio placeholders shift layout as
    // images stream in; a single nextTick scroll clamps to a too-short page.
    // Poll with rAF until the browser accepts the target offset, with a 1s
    // hard ceiling so a short page (all images cached) can't hang navigation.
    nextTick(() => {
      const start = Date.now()
      const tick = () => {
        tryScroll()
        if (window.scrollY >= targetY - 1 || Date.now() - start > 1000) return
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    resolve({ top: targetY, behavior: 'instant' as ScrollBehavior })
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
