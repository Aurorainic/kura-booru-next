import type { RouterConfig } from 'nuxt/schema'

// Scroll position memory: store scrollY per from.path in sessionStorage,
// restore on back/forward navigation. Forward navigation scrolls to top.
const SCROLL_KEY_PREFIX = 'kura-scroll:'

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

    // Only attempt sessionStorage on client.
    if (import.meta.client) {
      // Save the outgoing page's scroll offset before navigating away.
      try {
        const y = window.scrollY
        sessionStorage.setItem(SCROLL_KEY_PREFIX + from.fullPath, String(y))
      } catch { /* sessionStorage may be unavailable (private mode) */ }

      // If returning to a previously visited page, restore its offset.
      const saved = sessionStorage.getItem(SCROLL_KEY_PREFIX + to.fullPath)
      if (saved !== null) {
        const top = parseInt(saved, 10)
        if (!Number.isNaN(top)) {
          // Defer until DOM is settled (images with aspect-ratio may shift layout).
          return new Promise((resolve) => {
            nextTick(() => resolve({ top, behavior: 'instant' as ScrollBehavior }))
          })
        }
      }
    }

    return { top: 0 }
  },
}
