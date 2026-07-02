<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{
  content: string
}>()

const dismissed = ref(false)
const trackRef = ref<HTMLElement | null>(null)
const viewportRef = ref<HTMLElement | null>(null)
const idx = ref(0)
let rotateTimer: ReturnType<typeof setInterval> | null = null
let scrollTimers: ReturnType<typeof setTimeout>[] = []
let resizeTimer: ReturnType<typeof setTimeout> | null = null

const lines = computed(() => {
  return String(props.content || '')
    .split('\n')
    .map(t => t.trim())
    .filter(Boolean)
})

// Escape HTML first, then apply markdown transforms — prevents XSS from
// raw angle brackets or attribute injection in the announcement content.
function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/`(.+?)`/g, '<code>$1</code>')
  // Links: only allow http(s) and relative paths
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url: string) => {
    if (!/^https?:\/\/|^\/[^/]/.test(url)) return label
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-color); text-decoration: underline;">${label}</a>`
  })
  return html
}

onMounted(() => {
  try {
    if (sessionStorage.getItem('kura-announcement-dismissed') === '1') {
      dismissed.value = true
      return
    }
  } catch {}

  if (lines.value.length === 0) return

  // Start rotation after initial line is shown
  scrollTimers.push(setTimeout(() => startRotation(), 600))
  scheduleScroll(0, 500)
})

onUnmounted(() => {
  if (rotateTimer) clearInterval(rotateTimer)
  scrollTimers.forEach(clearTimeout)
  if (resizeTimer) clearTimeout(resizeTimer)
  window.removeEventListener('resize', onResize)
})

function startRotation() {
  if (rotateTimer) clearInterval(rotateTimer)
  if (lines.value.length <= 1) return
  rotateTimer = setInterval(() => {
    if (dismissed.value) return
    idx.value = (idx.value + 1) % lines.value.length
    scheduleScroll(idx.value, 500)
  }, 5000)
}

function scheduleScroll(lineIdx: number, delay: number) {
  const t = setTimeout(() => {
    if (dismissed.value) return
    const item = trackRef.value?.children[lineIdx]?.querySelector('span') as HTMLElement | null
    if (!item) return
    const vw = viewportRef.value?.clientWidth || 0
    const iw = item.scrollWidth
    if (iw <= vw) return
    const distance = iw - vw + 24
    const pxPerSec = 28
    const durationMs = Math.max(2000, (distance / pxPerSec) * 1000)
    item.style.transition = 'none'
    item.style.transform = 'translateX(0)'
    void item.offsetWidth
    item.style.transition = `transform ${durationMs}ms linear`
    item.style.transform = `translateX(${-distance}px)`
  }, delay)
  scrollTimers.push(t)
}

function onResize() {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (!dismissed.value) scheduleScroll(idx.value, 100)
  }, 200)
}

// Attach once — onMounted runs only on client
if (import.meta.client) {
  window.addEventListener('resize', onResize)
}

function dismiss() {
  if (dismissed.value) return
  dismissed.value = true
  if (rotateTimer) clearInterval(rotateTimer)
  scrollTimers.forEach(clearTimeout)
  try { sessionStorage.setItem('kura-announcement-dismissed', '1') } catch {}
}
</script>

<template>
  <div
    v-if="!dismissed && lines.length > 0"
    id="announcement-banner"
    class="sticky top-[var(--nav-h)] z-30 border-b border-[var(--border-color)] overflow-hidden"
    style="background: var(--accent-subtle); max-height: 32px; opacity: 1;"
  >
    <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 flex items-center gap-2.5" style="height: 32px;">
      <div class="flex items-center gap-1.5 flex-shrink-0">
        <svg class="w-3.5 h-3.5 text-[var(--accent-color)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span class="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--accent-color)]" style="letter-spacing: 0.08em;">公告</span>
      </div>
      <div class="w-px h-3.5 bg-[var(--border-color)] flex-shrink-0" />
      <div ref="viewportRef" class="flex-1 relative overflow-hidden" style="height: 18px;">
        <div ref="trackRef" class="absolute inset-x-0 top-0" :style="{ transform: `translateY(${-idx * 18}px)`, transition: 'transform 0.45s cubic-bezier(0.16,1,0.3,1)', willChange: 'transform' }">
          <div
            v-for="(line, i) in lines"
            :key="i"
            class="flex items-center overflow-hidden relative"
            style="height: 18px; line-height: 18px; white-space: nowrap;"
          >
            <span
              class="inline-block whitespace-nowrap"
              style="padding-right: 48px; will-change: transform; font-size: 0.75rem; color: var(--text-primary);"
              v-html="renderMarkdown(line)"
            />
          </div>
        </div>
      </div>
      <button
        type="button"
        class="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-color)]/10 transition-colors"
        aria-label="关闭公告"
        @click="dismiss"
      >
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
