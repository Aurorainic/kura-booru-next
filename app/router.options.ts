import type { RouterConfig } from 'nuxt/schema'

// Scroll memory: store scrollY per from.path in sessionStorage; restore on back/forward nav.
const SCROLL_KEY_PREFIX = 'kura-scroll:'

export default <RouterConfig>{
  scrollBehavior(to, from, savedPosition) {
    if (to.hash) {
      return { el: to.hash, behavior: 'smooth' }
    }

    if (savedPosition) {
      return savedPosition
    }

    if (!from || from.path === to.path) {
      return { top: 0 }
    }

    if (import.meta.client) {
      try {
        const y = window.scrollY
        sessionStorage.setItem(SCROLL_KEY_PREFIX + from.fullPath, String(y))
      } catch { /* sessionStorage may be unavailable (private mode) */ }

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
