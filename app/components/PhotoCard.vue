<script setup lang="ts">
import type { Post } from '~/types'

const props = withDefaults(defineProps<{
  post: Post
  isAdmin?: boolean
  index?: number
  currentPage?: number
  listParam?: string
  featured?: boolean
}>(), {
  isAdmin: false,
  index: 0,
  currentPage: 1,
  listParam: '',
  featured: false,
})

const previewUrl = getPreviewUrl(props.post)
const lqip = props.post.lqip
const showLqip = ref(false)
const imgLoaded = ref(false)
const modalOpen = ref(false)

function onCardClick(e: MouseEvent) {
  // Single click → open in-place zoom modal; middle-click / Ctrl+click → default (new tab / navigate)
  if (e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
    e.preventDefault()
    modalOpen.value = true
  }
}

onMounted(() => { showLqip.value = true })
</script>

<template>
  <NuxtLink
    :to="`/posts/${post.id}?from=gallery&page=${currentPage}${listParam ? '&list=' + listParam : ''}`"
    class="masonry-item block mb-2 cursor-zoom-in"
    :class="{ 'masonry-featured': featured }"
    :style="{
      animation: `blurReveal var(--duration-slow) var(--ease-out) both`,
      animationDelay: `${index < 12 ? index * 60 : 0}ms`,
    }"
    @click="onCardClick"
  >
    <div class="img-container" :style="{ aspectRatio: `${post.width} / ${post.height}` }">
      <!-- LQIP blur placeholder -->
      <img
        v-if="lqip && showLqip"
        :src="lqip"
        alt=""
        aria-hidden="true"
        class="lqip-blur"
      />
      <!-- Real image -->
      <img
        :src="previewUrl"
        :alt="post.title || `作品 ${post.id.slice(0, 8)}`"
        :width="post.width"
        :height="post.height"
        class="img-real"
        :class="{ loaded: imgLoaded }"
        loading="lazy"
        decoding="async"
        @load="imgLoaded = true"
      />
      <!-- Skeleton fallback (no LQIP) -->
      <div v-if="!lqip && !imgLoaded" class="skeleton absolute inset-0" />

      <!-- Rating badge (admin) -->
      <span
        v-if="isAdmin && post.rating !== 'safe'"
        class="absolute top-2 left-2 px-1.5 py-0.5 text-[0.625rem] font-bold rounded z-2"
        :class="post.rating === 'questionable' ? 'rating-questionable' : 'rating-explicit'"
        style="letter-spacing: 0.04em;"
      >
        {{ post.rating === 'questionable' ? '敏' : '限' }}
      </span>

      <!-- Tag overlay (desktop hover) -->
      <div class="tag-overlay absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex flex-col justify-end p-2.5 pointer-events-none">
        <div v-if="post.title" class="text-white text-[0.75rem] font-medium mb-1 truncate">{{ post.title }}</div>
        <div v-if="post.tags && post.tags.length > 0" class="flex flex-wrap gap-1">
          <span
            v-for="(tag, ti) in post.tags.slice(0, 5)"
            :key="tag.id"
            class="text-[0.6875rem] px-1.5 py-0.5 rounded bg-white/15 text-white backdrop-blur-sm truncate max-w-[100px]"
            :style="{ animation: `tagSlideUp var(--duration-instant) var(--ease-out) both`, animationDelay: `${ti * 30}ms` }"
          >{{ tag.name }}</span>
          <span v-if="post.tags.length > 5" class="text-[0.6875rem] px-1.5 py-0.5 rounded bg-white/15 text-white/70 backdrop-blur-sm">
            +{{ post.tags.length - 5 }}
          </span>
        </div>
      </div>

      <!-- Mobile bottom info bar -->
      <div class="md:hidden absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 pointer-events-none">
        <div class="flex items-center justify-between gap-2">
          <span class="text-white text-[0.6875rem] truncate flex-1">{{ post.title || post.source_site }}</span>
          <span
            v-if="isAdmin && post.rating !== 'safe'"
            class="text-[0.625rem] px-1 py-0.5 rounded font-bold flex-shrink-0"
            :class="post.rating === 'questionable' ? 'rating-questionable' : 'rating-explicit'"
          >{{ post.rating === 'questionable' ? '敏' : '限' }}</span>
        </div>
      </div>
    </div>
  </NuxtLink>

  <!-- Gallery zoom modal (open on click; "详情" button navigates to detail page) -->
  <ImageModal v-model="modalOpen" :src="previewUrl" :alt="post.title || `作品 ${post.id.slice(0, 8)}`" :detail-href="`/posts/${post.id}`" />
</template>
