<script setup lang="ts">
import type { Post } from '~/types'

const props = withDefaults(defineProps<{
  posts: Post[]
  isAdmin?: boolean
  currentPage?: number
  // 4.1 Featuring is opt-in: only the home gallery passes `featured`.
  // Deriving it from currentPage===1 bit us because /search and /tags/[name]
  // don't pass :current-page, so the default 1 made the first card span all
  // columns on every list view. Explicit prop = no "default value triggers it".
  featured?: boolean
}>(), {
  isAdmin: false,
  currentPage: 1,
  featured: false,
})

// URL-encoded post-id list so the detail page can do J/K navigation within
// the same gallery page. Cheap (only current page's IDs).
const listParam = computed(() =>
  encodeURIComponent(JSON.stringify(props.posts.map(p => p.id))),
)

// Featured card = first post, only when the caller explicitly opts in AND
// there's more than one post (a single-post view spanning all columns is
// pointless). Page-1-only logic lives in the caller (index.vue), not here.
const featuredPost = computed(() => props.featured && props.posts.length > 1 ? props.posts[0] : null)
const rest = computed(() => {
  if (featuredPost.value) return props.posts.slice(1)
  return props.posts
})
</script>

<template>
  <div class="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 2xl:columns-7 gap-2">
    <!-- Featured card: spans all columns. Opt-in via `featured` prop (home page 1 only). -->
    <PhotoCard
      v-if="featuredPost"
      :key="featuredPost.id"
      :post="featuredPost"
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
      :index="index + (featuredPost ? 1 : 0)"
      :current-page="currentPage"
      :list-param="listParam"
    />
  </div>
</template>
