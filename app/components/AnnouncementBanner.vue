<script setup lang="ts">
const props = defineProps<{
  content: string
}>()

onMounted(() => {
  var banner = document.getElementById('announcement-banner')
  var track = document.getElementById('announcement-track')
  var viewport = document.getElementById('announcement-viewport')
  var closeBtn = document.getElementById('announcement-close')
  if (!banner || !track || !viewport) return

  // Respect session-level dismissal
  try {
    if (sessionStorage.getItem('kura-announcement-dismissed') === '1') {
      banner.style.display = 'none'
      return
    }
  } catch (e) {}

  var content = props.content

  function simpleMarkdown(text: string) {
    var html = text
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
    html = html.replace(/`(.+?)`/g, '<code>$1</code>')
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: var(--accent-color); text-decoration: underline;">$1</a>')
    return html
  }

  var rawLines = String(content || '').split('\n')
  var lines: string[] = []
  for (var i = 0; i < rawLines.length; i++) {
    var t = rawLines[i].trim()
    if (t) lines.push(t)
  }
  if (lines.length === 0) return

  var LINE_H = 18
  var lineEls: any[] = []
  for (var j = 0; j < lines.length; j++) {
    var el = document.createElement('div')
    el.style.cssText = 'height:' + LINE_H + 'px;line-height:' + LINE_H + 'px;display:flex;align-items:center;white-space:nowrap;overflow:hidden;position:relative;'
    var inner = document.createElement('span')
    inner.style.cssText = 'display:inline-block;white-space:nowrap;padding-right:48px;will-change:transform;font-size:0.75rem;color:var(--text-primary);'
    inner.innerHTML = simpleMarkdown(lines[j])
    el.appendChild(inner)
    track.appendChild(el)
    lineEls.push({ row: el, inner: inner })
  }

  var dismissed = false
  var rotateTimer: any = null
  var idx = 0

  // Slide banner in
  requestAnimationFrame(function() {
    banner.style.transition = 'max-height 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.35s cubic-bezier(0.16,1,0.3,1)'
    banner.style.maxHeight = '32px'
    banner.style.opacity = '1'
  })

  function maybeScrollLine(item: any) {
    var vw = viewport!.clientWidth
    var iw = item.inner.scrollWidth
    if (iw <= vw) { item.inner.style.transition = 'none'; item.inner.style.transform = 'translateX(0)'; return }
    var distance = iw - vw + 24
    var pxPerSec = 28
    var durationMs = Math.max(2000, (distance / pxPerSec) * 1000)
    item.inner.style.transition = 'none'
    item.inner.style.transform = 'translateX(0)'
    void item.inner.offsetWidth
    item.inner.style.transition = 'transform ' + durationMs + 'ms linear'
    item.inner.style.transform = 'translateX(' + (-distance) + 'px)'
  }

  function showLine(n: number) {
    track!.style.transition = 'transform 0.45s cubic-bezier(0.16,1,0.3,1)'
    track!.style.transform = 'translateY(' + (-n * LINE_H) + 'px)'
    for (var k = 0; k < lineEls.length; k++) {
      if (k !== n) { lineEls[k].inner.style.transition = 'none'; lineEls[k].inner.style.transform = 'translateX(0)' }
    }
    setTimeout(function() { if (!dismissed) maybeScrollLine(lineEls[n]) }, 500)
  }

  function rotate() {
    if (dismissed || lines.length <= 1) return
    idx = (idx + 1) % lines.length
    showLine(idx)
  }

  function startRotation() {
    if (rotateTimer) clearInterval(rotateTimer)
    rotateTimer = setInterval(rotate, 5000)
  }

  setTimeout(function() { if (!dismissed) { showLine(0); startRotation() } }, 400)

  var resizeTimer: any = null
  window.addEventListener('resize', function() {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(function() { if (!dismissed) maybeScrollLine(lineEls[idx]) }, 200)
  })

  function dismiss() {
    if (dismissed) return
    dismissed = true
    if (rotateTimer) clearInterval(rotateTimer)
    banner!.style.maxHeight = '0'
    banner!.style.opacity = '0'
    setTimeout(function() { if (banner!.parentNode) banner!.parentNode.removeChild(banner!) }, 400)
    try { sessionStorage.setItem('kura-announcement-dismissed', '1') } catch (e) {}
  }

  if (closeBtn) closeBtn.addEventListener('click', dismiss)
})
</script>

<template>
  <div
    id="announcement-banner"
    class="sticky top-[var(--nav-h)] z-30 border-b border-[var(--border-color)] overflow-hidden"
    style="background: var(--accent-subtle); max-height: 0; opacity: 0;"
  >
    <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 flex items-center gap-2.5" style="height: 36px;">
      <div class="flex items-center gap-1.5 flex-shrink-0">
        <!-- Bell icon -->
        <svg class="w-3.5 h-3.5 text-[var(--accent-color)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span class="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--accent-color)]" style="letter-spacing: 0.08em;">公告</span>
      </div>
      <div class="w-px h-3.5 bg-[var(--border-color)] flex-shrink-0" />
      <div id="announcement-viewport" class="flex-1 relative overflow-hidden" style="height: 18px;">
        <div id="announcement-track" class="absolute inset-x-0 top-0" style="will-change: transform;"></div>
      </div>
      <button
        id="announcement-close"
        type="button"
        class="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-color)]/10 transition-colors"
        aria-label="关闭公告"
      >
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
