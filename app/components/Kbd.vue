<script setup lang="ts">
const props = defineProps<{ keys: string | string[] }>()
const { isMac } = usePlatform()

const tokens = computed(() => {
  const raw = Array.isArray(props.keys) ? props.keys : [props.keys]
  // Each entry is itself a + -joined combo (e.g. "G+T"). Flatten into groups.
  return raw.map(k => k.split('+').map(s => s.trim()))
})

// Render a single token: substitute platform-aware symbols.
function render(token: string): string {
  const t = token.toLowerCase()
  if (isMac.value) {
    if (t === 'cmd' || t === 'meta' || t === 'command') return '⌘'
    if (t === 'ctrl' || t === 'control') return '⌃'
    if (t === 'alt' || t === 'option') return '⌥'
    if (t === 'shift') return '⇧'
    if (t === 'enter' || t === 'return') return '⏎'
    if (t === 'esc' || t === 'escape') return 'Esc'
  }
  if (t === 'cmd' || t === 'meta' || t === 'command') return 'Ctrl'
  if (t === '/') return '/'
  if (t === '?') return '?'
  // Capitalize single letters for readability.
  if (token.length === 1) return token.toUpperCase()
  return token
}
</script>

<template>
  <span class="inline-flex items-center gap-0.5 align-middle">
    <template v-for="(group, gi) in tokens" :key="gi">
      <span v-if="gi > 0" class="text-[var(--text-muted)] mx-0.5 text-[0.625rem]">or</span>
      <kbd
        v-for="(tok, ti) in group"
        :key="gi + '-' + ti"
        class="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-color)] font-mono text-[0.6875rem] leading-none text-[var(--text-primary)] shadow-sm"
      >{{ render(tok) }}</kbd>
    </template>
  </span>
</template>
