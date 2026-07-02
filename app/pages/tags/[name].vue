<script setup lang="ts">
import type { TagCategory } from '~/types'

const { isAdmin, ssrCookie } = useSsrContext()
const route = useRoute()
const name = route.params.name as string

const page = computed(() => Number(route.query.page) || 1)
const perPage = computed(() => Number(route.query.per_page) || 40)

const { data: tag } = await useAsyncData(`tag-info-${name}`, async () => {
  try {
    return await fetchTag(name, ssrCookie.value)
  } catch {
    return null
  }
})

const { data: posts, refresh } = await useAsyncData(`tag-${name}-${page.value}-${perPage.value}`, async () => {
  try {
    return await fetchSearch(name, page.value, perPage.value, ssrCookie.value)
  } catch {
    return emptyPostsResponse()
  }
})

watch([page, perPage], () => {
  refresh()
})
</script>

<template>
  <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 py-6" style="padding-top: var(--space-page-top);">
    <NuxtLink to="/tags" class="filter-pill mb-4 inline-flex">← 标签列表</NuxtLink>

    <div class="mb-6">
      <h1 class="gradient-text mb-2" style="font-size: var(--font-size-display); font-weight: 700; font-family: var(--font-display); animation: maskWipe var(--duration-display) var(--ease-out) both;">{{ name }}</h1>
      <div class="flex items-center gap-3 mb-1">
        <span v-if="tag" class="inline-block text-xs px-2 py-0.5 rounded-full font-medium" :style="{ color: getTagCategoryVar(tag.category), background: `${getTagCategoryVar(tag.category)}/15`, border: `1px solid ${getTagCategoryVar(tag.category)}/30` }">{{ getTagCategoryLabel(tag.category) }}</span>
        <span v-if="tag?.translation" class="text-sm text-[var(--text-muted)]">({{ tag.translation }})</span>
      </div>
      <p class="text-[var(--font-size-meta)] text-[var(--text-muted)]" style="animation: countUp 0.4s var(--ease-out) 0.2s both;">{{ posts?.total || 0 }} 张插画</p>
    </div>

    <PhotoGrid v-if="posts && posts.items.length > 0" :posts="posts.items" :is-admin="isAdmin" />

    <div v-else class="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
      <p class="text-lg font-semibold mb-1">暂无插画</p>
      <p class="text-sm">这个标签下还没有图片</p>
    </div>

    <Pagination v-if="posts && posts.total_pages > 1" :current-page="page" :total-pages="posts.total_pages" :per-page="perPage" />
  </div>
</template>
