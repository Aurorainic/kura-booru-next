<script setup lang="ts">
const accentCookie = useCookie('kura-accent-hue')
const currentHue = ref(parseInt(accentCookie.value || '', 10) || 175)
const showSlider = ref(false)
let persistTimer: ReturnType<typeof setTimeout> | null = null

function updateHue(value: number) {
  currentHue.value = value
  document.documentElement.style.setProperty('--accent-hue', String(value))
  document.documentElement.style.setProperty('--accent-hue-end', String(accentEndHue(value)))
}

function onSliderChange(e: Event) {
  const value = Number((e.target as HTMLInputElement).value)
  updateHue(value)
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    accentCookie.value = String(value)
    localStorage.setItem('kura-accent-hue', String(value))
    window.dispatchEvent(new CustomEvent('kura-accent-change', { detail: { hue: value } }))
  }, 150)
}

let clickOutsideHandler: ((e: MouseEvent) => void) | null = null

onMounted(() => {
  clickOutsideHandler = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('[data-accent-picker]')) showSlider.value = false
  }
  document.addEventListener('click', clickOutsideHandler)
})

onUnmounted(() => {
  if (clickOutsideHandler) document.removeEventListener('click', clickOutsideHandler)
  if (persistTimer) clearTimeout(persistTimer)
})
</script>

<template>
  <div class="relative flex items-center justify-center group" data-accent-picker>
    <button
      type="button"
      @click="showSlider = !showSlider"
      class="w-9 h-9 rounded-[var(--radius-sm)] flex items-center justify-center transition-all hover:bg-[var(--accent-subtle)] active:scale-90"
      aria-label="选择强调色"
      title="强调色"
    >
      <!-- Palette icon -->
      <svg class="w-[18px] h-[18px] text-[var(--text-muted)] hover:text-[var(--accent-color)] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10a2 2 0 0 0 2-2c0-.52-.2-1.01-.57-1.38-.37-.36-.57-.86-.57-1.38 0-1.1.9-2 2-2 4.43 0 8-3.58 8-8 0-5.51-4.49-10-10-10Z" />
        <circle cx="7.5" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="12" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="16.5" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    </button>
    <div
      v-if="showSlider"
      class="absolute top-full right-0 mt-2 p-3 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-color)] shadow-lg z-50"
      @click.stop
    >
      <div class="text-xs text-[var(--text-muted)] text-center mb-2">色调 {{ currentHue }}°</div>
      <input
        type="range" min="0" max="360" :value="currentHue"
        @input="onSliderChange"
        class="w-32 h-2 rounded-full appearance-none cursor-pointer accent-[var(--accent-color)]"
        :style="{ background: `linear-gradient(to right, hsl(0,70%,50%),hsl(30,70%,50%),hsl(60,70%,50%),hsl(120,70%,50%),hsl(180,70%,50%),hsl(240,70%,50%),hsl(300,70%,50%),hsl(360,70%,50%))` }"
      />
    </div>
  </div>
</template>
