/**
 * Global keyboard shortcuts: / focus search, ? cheatsheet, G+T tags, J/K prev/next
 * post (?list=...), ←/→ prev/next page. Suppressed while typing in form fields.
 */

export function useKeyboardShortcuts(opts: {
  onPrevPost?: () => void
  onNextPost?: () => void
  onGoTags?: () => void
  onPrevPage?: () => void
  onNextPage?: () => void
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
    // "?" must stay typeable in text fields — cheatsheet opens via the keycap chip instead.
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
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
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
      case 'ArrowLeft':
        opts.onPrevPage?.()
        break
      case 'ArrowRight':
        opts.onNextPage?.()
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
