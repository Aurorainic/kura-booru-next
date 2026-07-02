<script setup lang="ts">
import type { Tag } from '~/types'

const props = withDefaults(defineProps<{
  tag: Tag
  showTranslation?: boolean
  link?: boolean
  extraClass?: string
}>(), {
  showTranslation: true,
  link: true,
  extraClass: '',
})
</script>

<template>
  <NuxtLink
    v-if="link"
    :to="`/tags/${encodeURIComponent(tag.name)}`"
    :class="['tag-badge inline-flex items-baseline gap-1 group/tag', extraClass]"
  >
    <span class="w-0.5 h-3 rounded-full flex-shrink-0 self-center" :style="{ background: getTagCategoryVar(tag.category) }" />
    <span class="name text-[var(--text-primary)] transition-colors duration-[var(--duration-instant)] group-hover/tag:text-[var(--accent-color)]" :style="{ fontFamily: 'var(--font-display)' }">{{ tag.name }}</span>
    <span v-if="showTranslation && tag.translation" class="text-[0.75em] text-[var(--text-muted)]">{{ tag.translation }}</span>
    <span v-if="tag.post_count > 0" class="text-[0.75em] text-[var(--text-muted)] font-mono tabular-nums ml-0.5">{{ tag.post_count }}</span>
  </NuxtLink>
  <span
    v-else
    :class="['tag-badge inline-flex items-baseline gap-1', extraClass]"
  >
    <span class="w-0.5 h-3 rounded-full flex-shrink-0 self-center" :style="{ background: getTagCategoryVar(tag.category) }" />
    <span class="name text-[var(--text-primary)]" :style="{ fontFamily: 'var(--font-display)' }">{{ tag.name }}</span>
    <span v-if="showTranslation && tag.translation" class="text-[0.75em] text-[var(--text-muted)]">{{ tag.translation }}</span>
    <span v-if="tag.post_count > 0" class="text-[0.75em] text-[var(--text-muted)] font-mono tabular-nums ml-0.5">{{ tag.post_count }}</span>
  </span>
</template>

<style scoped>
.tag-badge {
  border-left: 2px solid var(--category-color, transparent);
  padding-left: 6px;
  text-decoration: none;
}
</style>
