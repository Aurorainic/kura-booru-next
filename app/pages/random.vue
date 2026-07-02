<script setup lang="ts">
const { ssrCookie } = useSsrContext()

const { data: post } = await useAsyncData('random-initial', async () => {
  try {
    return await fetchRandomPost(ssrCookie.value)
  } catch {
    return null
  }
})

const loading = ref(false)
const currentPost = ref(post.value)

async function shuffle() {
  if (loading.value) return
  loading.value = true
  try {
    const newPost = await fetchRandomPost()
    currentPost.value = newPost
  } catch {
    // keep current
  } finally {
    loading.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault()
    shuffle()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 py-6" style="padding-top: var(--space-page-top);">
    <div class="flex flex-col items-center gap-6">
      <h1 class="gradient-text text-center" style="font-size: clamp(1.25rem, 2vw, 1.75rem); font-weight: 700; font-family: var(--font-display);">随机发现</h1>

      <div class="relative w-full max-w-[680px] rounded-[var(--radius-md)] overflow-hidden bg-[var(--bg-surface)] border border-[var(--border-color)] transition-opacity duration-300" :style="{ opacity: loading ? 0.3 : 1 }">
        <NuxtLink v-if="currentPost" :to="`/posts/${currentPost.id}`" class="block">
          <img :src="getPreviewUrl(currentPost)" :alt="currentPost.title || '随机插画'" class="w-full h-auto object-contain" loading="eager" decoding="async" />
        </NuxtLink>
        <div v-else class="flex items-center justify-center py-24 text-[var(--text-muted)]">
          <p>暂无图片</p>
        </div>
      </div>

      <div v-if="currentPost" class="w-full max-w-[680px] flex flex-col gap-2 text-center">
        <div class="flex items-center justify-center gap-2 text-sm">
          <span class="font-medium text-[var(--text-primary)]">{{ currentPost.title || '—' }}</span>
          <span class="px-2 py-0.5 text-xs font-bold rounded" :class="getRatingColorClass(currentPost.rating)">{{ getRatingLabel(currentPost.rating) }}</span>
        </div>
        <div class="text-xs text-[var(--text-muted)]">{{ getSourceSiteLabel(currentPost.source_site) }} · {{ currentPost.width }}×{{ currentPost.height }}</div>
        <!-- F-P1-4: Tag badges -->
        <div v-if="currentPost.tags?.length" class="flex flex-wrap justify-center gap-1.5 mt-1">
          <TagBadge v-for="tag in currentPost.tags.slice(0, 8)" :key="tag.id" :tag="tag" :show-translation="true" :link="true" />
          <span v-if="currentPost.tags.length > 8" class="text-xs text-[var(--text-muted)]">+{{ currentPost.tags.length - 8 }}</span>
        </div>
      </div>

      <button
        type="button"
        @click="shuffle"
        :disabled="loading"
        class="flex items-center gap-2 px-6 py-3 rounded-[var(--radius-button)] font-medium text-sm transition-all active:scale-95"
        style="background: var(--accent-color); color: var(--bg-primary);"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
          <path d="m18 2 4 4-4 4" />
          <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
          <path d="M22 18h-5.9a5.5 5.5 0 0 1-3.8-2.6l-.5-.8" />
          <path d="m18 14 4 4-4 4" />
        </svg>
        {{ loading ? '加载中…' : '随机刷新' }}
      </button>

      <p class="text-xs text-[var(--text-muted)]">按 <kbd class="px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-surface)] font-mono">Space</kbd> 也可刷新</p>
    </div>
  </div>
</template>
