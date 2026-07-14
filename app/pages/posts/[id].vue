<script setup lang="ts">
import type { Tag, TagCategory, Rating } from '~/types'

const { isAdmin, ssrCookie } = useSsrContext()
const route = useRoute()
const id = route.params.id as string

const { data: post, error } = await useAsyncData(`post-${id}`, async () => {
  try {
    return await fetchPost(id, ssrCookie.value)
  } catch {
    return null
  }
})

if (!post.value || error.value) {
  throw createError({ statusCode: 404, statusMessage: 'Post not found' })
}

const TAG_CATEGORY_ORDER: TagCategory[] = ['copyright', 'character', 'artist', 'general', 'meta']
const groupedTags = computed(() => {
  const groups: Record<string, Tag[]> = {}
  for (const cat of TAG_CATEGORY_ORDER) {
    const tags = (post.value?.tags || []).filter(t => t.category === cat)
    if (tags.length > 0) groups[cat] = tags
  }
  return groups
})

const previewUrl = computed(() => post.value ? getPreviewUrl(post.value) : '')
const originalUrl = computed(() => post.value ? getOriginalUrl(post.value) : '')
const thumbUrl = computed(() => post.value ? getThumbUrl(post.value) : '')

// Admin: reactive rating editor
const selectedRating = ref(post.value?.rating || 'safe')
const ratingSaveVisible = ref(false)
const ratingMessage = ref('')
const saving = ref(false)

watch(selectedRating, (val) => {
  ratingSaveVisible.value = val !== post.value?.rating
})

async function saveRating() {
  if (!post.value) return
  saving.value = true
  try {
    const updated = await updatePostRating(post.value.id, selectedRating.value)
    post.value = { ...post.value, ...updated }
    ratingSaveVisible.value = false
    ratingMessage.value = '已保存'
    setTimeout(() => { ratingMessage.value = '' }, 2000)
  } catch {
    ratingMessage.value = '保存失败'
    alert('保存失败')
  } finally {
    saving.value = false
  }
}

// Admin: reactive tag management
const newTagName = ref('')

async function addTag() {
  if (!newTagName.value.trim() || !post.value) return
  try {
    const updated = await updatePostTags(post.value.id, { add_tags: [newTagName.value.trim()] })
    post.value = { ...post.value, ...updated }
    newTagName.value = ''
  } catch {
    alert('添加标签失败')
  }
}

async function removeTag(tagId: string) {
  if (!post.value) return
  if (!confirm('确定要移除此标签吗？')) return
  try {
    const updated = await updatePostTags(post.value.id, { remove_tag_ids: [tagId] })
    post.value = { ...post.value, ...updated }
  } catch {
    alert('移除标签失败')
  }
}

// Image modal (delegates pan/zoom/pinch to <ImageModal>)
const showModal = ref(false)

function openModal() { showModal.value = true }

// Delete post
const deleting = ref(false)

async function deletePostAction() {
  if (!confirm('确定要删除这张插画吗？此操作不可恢复，将同时删除存储文件。')) return
  deleting.value = true
  try {
    await deletePost(post.value!.id)
    navigateTo('/')
  } catch {
    alert('删除失败')
    deleting.value = false
  }
}

// Back to gallery with page context restored
function goBack() {
  const from = route.query.from as string | undefined
  const page = route.query.page as string | undefined
  if (from === 'gallery' && page) {
    // Clear the helper query params so they don't pollute the gallery URL.
    navigateTo({ path: '/', query: { page } })
  } else {
    navigateTo('/')
  }
}

// In-page J/K pagination between posts. We only know the IDs if the gallery
// passed them; otherwise J/K is a no-op. (Cheap, opt-in via query param.)
const navList = computed(() => {
  const raw = route.query.list as string | undefined
  if (!raw) return null
  try { return JSON.parse(decodeURIComponent(raw)) as string[] }
  catch { return null }
})
function prevPost() {
  if (!navList.value) return
  const i = navList.value.indexOf(id)
  if (i > 0) navigateTo(`/posts/${navList.value[i - 1]}`)
}
function nextPost() {
  if (!navList.value) return
  const i = navList.value.indexOf(id)
  if (i >= 0 && i < navList.value.length - 1) navigateTo(`/posts/${navList.value[i + 1]}`)
}
// ponytail: detail page only wires J/K to prev/next post. The layout-level
// useKeyboardShortcuts already handles /, G+T, and ? — don't duplicate listeners.
useKeyboardShortcuts({ onPrevPost: prevPost, onNextPost: nextPost })
const previewLoaded = ref(false)
function onPreviewLoad() { previewLoaded.value = true }

function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

useHead({
  title: post.value?.title || `作品 ${id.slice(0, 8)}`,
  meta: [{ name: 'description', content: stripHtml(post.value?.description).slice(0, 160) || `来自 ${getSourceSiteLabel(post.value?.source_site || '')} 的插画` }],
})
</script>

<template>
  <div v-if="post" class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 py-4">
    <!-- Top bar: back -->
    <div class="mb-4">
      <NuxtLink to="/" class="nav-btn" @click.prevent="goBack">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        返回
      </NuxtLink>
    </div>

    <!-- Three-column layout: left (tags), center (image), right (info) -->
    <div class="flex flex-col lg:flex-row gap-6">

      <!-- Left sidebar: Tags by category (desktop, sticky) -->
      <aside class="hidden lg:block lg:w-64 flex-shrink-0">
        <div class="sticky top-4 space-y-5">
          <div class="dash-card !p-4">
            <h2 class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-1.5 mb-3">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /></svg>
              标签
            </h2>
            <div v-for="(tagGroup, cat) in groupedTags" :key="cat" class="mb-4 last:mb-0">
              <div class="flex items-center gap-2 mb-1.5">
                <div class="w-2 h-0.5 rounded-full" :style="{ background: getTagCategoryVar(cat as TagCategory) }" />
                <h3 class="text-[0.6875rem] font-semibold" :style="{ color: getTagCategoryVar(cat as TagCategory) }">{{ getTagCategoryLabel(cat as TagCategory) }} ({{ tagGroup.length }})</h3>
              </div>
              <ul class="space-y-0.5">
                <li v-for="tag in tagGroup" :key="tag.id" class="relative rounded-[var(--radius-sm)] px-1.5 py-0.5 -mx-1.5 hover:bg-[var(--accent-subtle)] transition-colors group/tag">
                  <NuxtLink :to="`/tags/${encodeURIComponent(tag.name)}`" class="flex items-center justify-between gap-2">
                    <span class="truncate text-sm">
                      <span class="text-[var(--text-primary)] hover:text-[var(--accent-color)] transition-colors">{{ tag.name }}</span>
                      <span v-if="tag.translation" class="text-[0.625rem] text-[var(--text-muted)] ml-1.5">{{ tag.translation }}</span>
                    </span>
                    <span v-if="tag.post_count > 0" class="text-[0.6875rem] text-[var(--text-muted)] font-mono tabular-nums flex-shrink-0">{{ tag.post_count }}</span>
                  </NuxtLink>
                  <!-- Admin remove button -->
                  <button v-if="isAdmin" class="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/tag:opacity-100 text-[var(--color-danger)] text-xs px-1" @click.stop="removeTag(tag.id)">✕</button>
                </li>
              </ul>
            </div>

            <!-- Admin: add tag -->
            <div v-if="isAdmin" class="mt-3 pt-3 border-t border-[var(--border-color)]">
              <form class="flex gap-1" @submit.prevent="addTag">
                <input v-model="newTagName" type="text" placeholder="添加标签…" class="flex-1 text-xs px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]" />
                <button type="submit" class="btn-primary !text-xs !px-2.5 !py-1.5">添加</button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <!-- Center: Image -->
      <main class="flex-1 min-w-0">
        <div style="animation: imageReveal var(--duration-slow) var(--ease-out);">
          <div class="relative rounded-[var(--radius-lg)] overflow-hidden cursor-zoom-in" @click="openModal">
            <!-- LQIP base64 placeholder (real, generated by sharp) -->
            <img
              v-if="post.lqip"
              :src="post.lqip"
              alt=""
              class="img-blur-placeholder absolute inset-0 w-full h-full object-cover"
              :class="{ 'loaded': previewLoaded }"
              aria-hidden="true"
            />
            <!-- Fallback: 300px thumbnail blur (when no LQIP data, e.g. old posts) -->
            <img
              v-else
              :src="thumbUrl"
              alt=""
              class="img-blur-placeholder absolute inset-0 w-full h-full object-cover"
              :class="{ 'loaded': previewLoaded }"
              aria-hidden="true"
            />
            <img
              :src="previewUrl"
              :alt="post.title || '插画'"
              class="relative w-full h-auto transition-opacity duration-300"
              :class="{ 'opacity-100': previewLoaded, 'opacity-0': !previewLoaded }"
              :width="post.width"
              :height="post.height"
              loading="eager"
              decoding="async"
              fetchpriority="high"
              :style="{ aspectRatio: `${post.width} / ${post.height}` }"
              @load="onPreviewLoad"
            />
          </div>
        </div>

        <!-- v0.7.8 PR-C: series nav (only rendered when this post is part of a multi-image series) -->
        <PostSeriesNav
          v-if="post.series"
          :series="post.series"
          :current-post-id="post.id"
          :is-admin="isAdmin"
        />

        <!-- Mobile: tags as pills (below image) -->
        <div class="lg:hidden mt-4 flex flex-wrap gap-2">
          <template v-for="tag in post.tags" :key="tag.id">
            <NuxtLink
              :to="`/tags/${encodeURIComponent(tag.name)}`"
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors hover:opacity-80"
              :style="{ background: `${getTagCategoryVar(tag.category)}/15`, color: getTagCategoryVar(tag.category), border: `1px solid ${getTagCategoryVar(tag.category)}/30` }"
            >
              <span>{{ tag.name }}</span>
              <span v-if="tag.translation" class="opacity-60">({{ tag.translation }})</span>
            </NuxtLink>
          </template>

          <!-- Mobile admin: add tag -->
          <div v-if="isAdmin" class="w-full mt-2">
            <form class="flex gap-1" @submit.prevent="addTag">
              <input v-model="newTagName" type="text" placeholder="添加标签…" class="flex-1 text-xs px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]" />
              <button type="submit" class="btn-primary !text-xs !px-2.5 !py-1.5">添加</button>
            </form>
          </div>
        </div>

        <!-- Mobile: info details (below image and tags) -->
        <div class="lg:hidden mt-4">
          <PostInfoPanel
            :post="post"
            :is-admin="isAdmin"
            :selected-rating="selectedRating"
            :rating-save-visible="ratingSaveVisible"
            :rating-message="ratingMessage"
            :saving="saving"
            :deleting="deleting"
            @update:selected-rating="(v) => (selectedRating = v as Rating)"
            @save-rating="saveRating"
            @delete="deletePostAction"
          />
        </div>
      </main>

      <!-- Right sidebar: Info (desktop, sticky) -->
      <aside class="hidden lg:block lg:w-80 flex-shrink-0">
        <div class="sticky top-4">
          <PostInfoPanel
            :post="post"
            :is-admin="isAdmin"
            :selected-rating="selectedRating"
            :rating-save-visible="ratingSaveVisible"
            :rating-message="ratingMessage"
            :saving="saving"
            :deleting="deleting"
            @update:selected-rating="(v) => (selectedRating = v as Rating)"
            @save-rating="saveRating"
            @delete="deletePostAction"
          />
        </div>
      </aside>
    </div>

    <!-- Image Modal (delegates pan/zoom/pinch to <ImageModal>) -->
    <ImageModal v-model="showModal" :src="originalUrl" :alt="post.title || '原图'" />
  </div>
</template>
