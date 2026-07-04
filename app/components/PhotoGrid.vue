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
</script>

<template>
  <div class="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 2xl:columns-7 gap-2">
    <PhotoCard
      v-for="(post, index) in posts"
      :key="post.id"
      :post="post"
      :is-admin="isAdmin"
      :index="index"
      :current-page="currentPage"
      :list-param="listParam"
    />
  </div>
</template>
