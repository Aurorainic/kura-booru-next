<script setup lang="ts">
import type { Post } from '~/types'

defineProps<{
  posts: Post[]
  isAdmin?: boolean
}>()
</script>

<template>
  <div class="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 2xl:columns-7 gap-2">
    <PhotoCard
      v-for="(post, index) in posts"
      :key="post.id"
      :post="post"
      :is-admin="isAdmin"
      :index="index"
    />
  </div>
</template>
