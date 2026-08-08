<script setup lang="ts">
import type { Post, Rating } from '~/types'

const props = defineProps<{
  post: Post
  isAdmin: boolean
  selectedRating: Rating
  ratingSaveVisible: boolean
  ratingMessage: string
  saving: boolean
  deleting: boolean
}>()

const emit = defineEmits<{
  (e: 'update:selectedRating', v: Rating): void
  (e: 'save-rating'): void
  (e: 'delete'): void
}>()
</script>

<template>
  <div class="space-y-5">
    <!-- Title + Rating -->
    <div>
      <h1 v-if="post.title" class="text-lg font-bold text-[var(--text-primary)] leading-snug mb-2" style="font-family: var(--font-display); letter-spacing: -0.01em;">{{ post.title }}</h1>
      <span class="inline-block px-2.5 py-0.5 rounded-full text-[0.6875rem] font-bold" :class="getRatingColorClass(post.rating)">{{ getRatingLabel(post.rating) }}</span>
    </div>

    <!-- Description -->
    <div v-if="post.description" class="description text-sm text-[var(--text-primary)] leading-relaxed">{{ post.description }}</div>

    <!-- Info card -->
    <div class="dash-card !p-4 space-y-3">
      <h2 class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-1.5">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
        图片信息
      </h2>
      <dl class="space-y-2 text-sm">
        <div class="flex items-baseline gap-2">
          <dt class="text-[var(--text-muted)] text-xs w-14 flex-shrink-0">来源</dt>
          <dd>
            <a v-if="post.source_url" :href="post.source_url" target="_blank" rel="noopener noreferrer" class="gradient-text font-medium hover:underline text-xs">{{ getSourceSiteLabel(post.source_site) }} ↗</a>
            <span v-else class="text-xs">{{ getSourceSiteLabel(post.source_site) }}</span>
          </dd>
        </div>
        <div class="flex items-baseline gap-2">
          <dt class="text-[var(--text-muted)] text-xs w-14 flex-shrink-0">尺寸</dt>
          <dd class="text-xs tabular-nums">{{ post.width }} × {{ post.height }}</dd>
        </div>
        <div class="flex items-baseline gap-2">
          <dt class="text-[var(--text-muted)] text-xs w-14 flex-shrink-0">文件大小</dt>
          <dd class="text-xs tabular-nums">{{ formatFileSize(post.file_size) }}</dd>
        </div>
        <div class="flex items-baseline gap-2">
          <dt class="text-[var(--text-muted)] text-xs w-14 flex-shrink-0">格式</dt>
          <dd class="text-xs">{{ post.mime_type }}</dd>
        </div>
        <div class="flex items-baseline gap-2">
          <dt class="text-[var(--text-muted)] text-xs w-14 flex-shrink-0">添加时间</dt>
          <dd class="text-xs tabular-nums">{{ formatDate(post.created_at) }}</dd>
        </div>
      </dl>
    </div>

    <!-- Actions + admin rating editor share one left-aligned container -->
    <div class="space-y-3">
      <!-- Actions -->
      <div class="flex items-center gap-3 flex-wrap">
        <a :href="getOriginalUrl(post)" target="_blank" rel="noopener noreferrer" class="btn-primary">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
          原图
        </a>
        <button
          v-if="isAdmin"
          type="button"
          class="btn-ghost !border !border-[var(--color-danger)]/40 !text-[var(--color-danger)] hover:!bg-[var(--color-danger)]/10"
          :disabled="deleting"
          @click="emit('delete')"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
          {{ deleting ? '删除中…' : '删除' }}
        </button>
      </div>

      <!-- Admin rating editor -->
      <div v-if="isAdmin" class="flex items-center gap-2">
        <select :value="selectedRating" class="text-xs px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)]" @change="emit('update:selectedRating', ($event.target as HTMLSelectElement).value as Rating)">
          <option value="safe">公开</option>
          <option value="questionable">敏感</option>
          <option value="explicit">限制</option>
        </select>
        <button
          v-if="ratingSaveVisible"
          type="button"
          class="btn-primary !text-xs !px-2.5 !py-1.5"
          :disabled="saving"
          @click="emit('save-rating')"
        >{{ saving ? '保存中…' : '保存' }}</button>
        <span v-if="ratingMessage" class="text-xs text-[var(--text-muted)]">{{ ratingMessage }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
</style>
