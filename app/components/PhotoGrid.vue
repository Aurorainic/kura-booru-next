<script setup lang="ts">
import type { Post } from '~/types'

const props = withDefaults(defineProps<{
  posts: Post[]
  isAdmin?: boolean
  currentPage?: number
}>(), {
  isAdmin: false,
  currentPage: 1,
})

// URL-encoded post-id list so the detail page can do J/K navigation within
// the same gallery page. Cheap (only current page's IDs).
const listParam = computed(() =>
  encodeURIComponent(JSON.stringify(props.posts.map(p => p.id))),
)

// 4.1 Featuring: first card on page 1 spans 2 columns (masonry column-span).
// Only on page 1 — paginated views stay uniform so users can scan predictably.
const featured = computed(() => props.currentPage === 1 && props.posts.length > 1 ? props.posts[0] : null)
const rest = computed(() => {
  if (featured.value) return props.posts.slice(1)
  return props.posts
})
</script>

<template>
  <div class="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 2xl:columns-7 gap-2">
    <!-- Featured card: spans 2 columns on sm+ (page 1 only) -->
    <PhotoCard
      v-if="featured"
      :key="featured.id"
      :post="featured"
      :is-admin="isAdmin"
      :index="0"
      :current-page="currentPage"
      :list-param="listParam"
      featured
    />
    <PhotoCard
      v-for="(post, index) in rest"
      :key="post.id"
      :post="post"
      :is-admin="isAdmin"
      :index="index + (featured ? 1 : 0)"
      :current-page="currentPage"
      :list-param="listParam"
    />
  </div>
</template>
