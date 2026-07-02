<script setup lang="ts">
const themes = [
  // Monitor/display icon — auto = follow system preference
  { key: 'auto', label: '自动', icon: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zM8 21h8M12 17v4' },
  { key: 'light', label: '浅色', icon: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42' },
  { key: 'dark', label: '深色', icon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z' },
]

const current = ref('auto')
const spinning = ref(false)

onMounted(() => {
  current.value = localStorage.getItem('kura-theme-preference') || 'auto'
  applyTheme(current.value)

  // F-C-1: Listen for system theme changes when in 'auto' mode
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onSystemChange = () => {
    if (current.value === 'auto') applyTheme('auto')
  }
  mq.addEventListener('change', onSystemChange)
  onUnmounted(() => mq.removeEventListener('change', onSystemChange))
})

function applyTheme(theme: string) {
  const resolved = theme === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(resolved)
}

function cycle() {
  const order = ['auto', 'light', 'dark']
  const next = order[(order.indexOf(current.value) + 1) % order.length]
  current.value = next
  localStorage.setItem('kura-theme-preference', next)
  applyTheme(next)
  spinning.value = true
  setTimeout(() => { spinning.value = false }, 300)
}

const activeTheme = computed(() => themes.find(t => t.key === current.value) || themes[0])
</script>

<template>
  <button
    type="button"
    @click="cycle"
    class="relative flex items-center justify-center w-9 h-9 rounded-[var(--radius-sm)] transition-all duration-[var(--duration-instant)] hover:bg-[var(--accent-subtle)] active:scale-85 group"
    :aria-label="`切换主题(当前：${activeTheme.label})`"
    :title="`主题：${activeTheme.label}`"
  >
    <svg
      class="w-[18px] h-[18px] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-all"
      :class="{ 'animate-spin': spinning }"
      :style="spinning ? { transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' } : {}"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    >
      <path :d="activeTheme.icon" />
    </svg>
    <span class="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{{ activeTheme.label }}</span>
  </button>
</template>
