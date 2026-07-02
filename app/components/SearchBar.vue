<script setup lang="ts">
import type { Tag } from '~/types'

const props = withDefaults(defineProps<{
  initialQuery?: string
  placeholder?: string
}>(), {
  initialQuery: '',
  placeholder: '搜索标签...(用 + 组合，用 - 排除)',
})

const query = ref(props.initialQuery)
const suggestions = ref<Tag[]>([])
const showSuggestions = ref(false)
const selectedIndex = ref(-1)
const loading = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function onInput(value: string) {
  query.value = value
  if (debounceTimer) clearTimeout(debounceTimer)

  const parts = value.split(/[\s+]+/)
  const currentTag = parts[parts.length - 1].replace(/^-/, '')

  if (!currentTag || currentTag.length < 2) {
    suggestions.value = []
    showSuggestions.value = false
    return
  }

  debounceTimer = setTimeout(async () => {
    loading.value = true
    try {
      const results = await fetchAutocomplete(currentTag)
      suggestions.value = results
      showSuggestions.value = true
      selectedIndex.value = -1
    } catch {
      suggestions.value = []
    } finally {
      loading.value = false
    }
  }, 250)
}

function onKeyDown(e: KeyboardEvent) {
  if (!showSuggestions.value || suggestions.value.length === 0) {
    if (e.key === 'Enter') submit()
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, suggestions.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, -1)
  } else if (e.key === 'Enter') {
    if (selectedIndex.value >= 0) {
      e.preventDefault()
      selectSuggestion(suggestions.value[selectedIndex.value])
    } else {
      submit()
    }
  } else if (e.key === 'Escape') {
    showSuggestions.value = false
    selectedIndex.value = -1
  }
}

function selectSuggestion(tag: Tag) {
  const parts = query.value.split(/([\s+]+)/)
  const last = parts[parts.length - 1]
  const hasNegation = last.startsWith('-')
  parts[parts.length - 1] = (hasNegation ? '-' : '') + tag.name
  query.value = parts.join('')
  showSuggestions.value = false
  inputEl.value?.focus()
}

function submit() {
  const q = query.value.trim()
  if (q) {
    navigateTo(`/search?q=${encodeURIComponent(q)}`)
  }
}

function onFocus() {
  if (suggestions.value.length > 0) showSuggestions.value = true
}

function onBlur() {
  setTimeout(() => { showSuggestions.value = false }, 150)
}
</script>

<template>
  <div class="relative w-full">
    <div class="relative">
      <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
      <input
        ref="inputEl"
        type="search"
        :value="query"
        @input="onInput(($event.target as HTMLInputElement).value)"
        @keydown="onKeyDown"
        @focus="onFocus"
        @blur="onBlur"
        role="combobox"
        :aria-expanded="showSuggestions"
        aria-haspopup="listbox"
        :placeholder="placeholder"
        class="w-full py-1.5 pl-9 pr-8 rounded-[var(--radius-full)] border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-[0.875rem] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-color)] focus:ring-2 focus:ring-[var(--accent-subtle)] transition-all"
      />
      <button
        v-if="query && !loading"
        @click="query = ''; suggestions = []; showSuggestions = false; inputEl?.focus()"
        class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        aria-label="清除搜索"
      >
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
      <svg v-else-if="loading" class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>

    <Transition name="suggest">
      <ul
        v-if="showSuggestions && suggestions.length > 0"
        role="listbox"
        class="absolute top-full left-0 right-0 mt-1 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-color)] shadow-lg overflow-hidden z-50 max-h-64 overflow-y-auto"
      >
        <li
          v-for="(tag, i) in suggestions"
          :key="tag.id"
          role="option"
          @mousedown.prevent="selectSuggestion(tag)"
          @mouseenter="selectedIndex = i"
          :class="[
            'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors text-sm',
            i === selectedIndex ? 'bg-[var(--accent-subtle)]' : '',
          ]"
        >
          <span class="w-0.5 h-4 rounded-full flex-shrink-0" :style="{ background: getTagCategoryVar(tag.category) }" />
          <span class="font-medium text-[var(--text-primary)]" :style="{ fontFamily: 'var(--font-display)' }">{{ tag.name }}</span>
          <span v-if="tag.translation" class="text-[0.75rem] text-[var(--text-muted)]">{{ tag.translation }}</span>
          <span class="ml-auto text-[0.6875rem] text-[var(--text-muted)] font-mono tabular-nums">{{ tag.post_count }}</span>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.suggest-enter-active, .suggest-leave-active {
  transition: all 0.2s var(--ease-out);
}
.suggest-enter-from, .suggest-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
