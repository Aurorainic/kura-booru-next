/**
 * Global keyboard shortcuts composable.
 *
 * Bindings:
 *   /         focus the main search input
 *   ?         open the keyboard cheatsheet modal
 *   G then T  jump to tags (the first tag on the current page)
 *   J / K     next / previous post in the gallery list (when on detail page
 *             and the post-id list was passed in via ?list=...)
 *
 * All bindings are suppressed when the active element is a form field
 * (input / textarea / select / [contenteditable]), so users can type those
 * characters normally. Modal open / cheatsheet state is exposed so callers
 * can wire up their own modal component.
 */

export function useKeyboardShortcuts(opts: {
  searchInputRef?: Ref<HTMLInputElement | null>
  onPrevPost?: () => void
  onNextPost?: () => void
  onGoTags?: () => void
} = {}) {
  const cheatsheetOpen = ref(false)
  let gPressed = false
  let gTimer: ReturnType<typeof setTimeout> | null = null

  function isTyping() {
    const el = document.activeElement
    if (!el) return false
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if ((el as HTMLElement).isContentEditable) return true
    return false
  }

  function onKeydown(e: KeyboardEvent) {
    // Cheatsheet toggle works even when typing? No — keep it bound to body only
    // so users can type "?" inside text fields normally. Open via the keycap
    // chip button instead.
    if (isTyping()) return

    // Two-key sequence: G then T → tags
    if (e.key === 'g' || e.key === 'G') {
      gPressed = true
      if (gTimer) clearTimeout(gTimer)
      gTimer = setTimeout(() => { gPressed = false }, 700)
      return
    }
    if (gPressed && (e.key === 't' || e.key === 'T')) {
      e.preventDefault()
      gPressed = false
      if (gTimer) { clearTimeout(gTimer); gTimer = null }
      opts.onGoTags?.()
      return
    }
    gPressed = false

    switch (e.key) {
      case '/':
        e.preventDefault()
        opts.searchInputRef?.value?.focus()
        break
      case '?':
        e.preventDefault()
        cheatsheetOpen.value = true
        break
      case 'j':
      case 'J':
        e.preventDefault()
        opts.onNextPost?.()
        break
      case 'k':
      case 'K':
        e.preventDefault()
        opts.onPrevPost?.()
        break
    }
  }

  onMounted(() => document.addEventListener('keydown', onKeydown))
  onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown)
    if (gTimer) clearTimeout(gTimer)
  })

  return { cheatsheetOpen }
}
