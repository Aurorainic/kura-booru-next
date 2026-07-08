<script setup lang="ts">
import type { Tag, TagCategory } from '~/types'

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

// 4.2 Quick-jump: smooth-scroll to the tags/info sections below the immersive image.
function scrollToSection(id: 'tags' | 'info') {
  if (import.meta.client) {
    document.getElementById(`${id}-section`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
</script>

<template>
  <div v-if="post" class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 py-4">
    <!-- Top bar: back + quick-jump toggles (4.2) -->
    <div class="mb-4 flex items-center justify-between gap-3">
      <NuxtLink to="/" class="nav-btn" @click.native.prevent="goBack">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        返回
      </NuxtLink>
      <!-- Quick-jump buttons: scroll to the tag/info sections below the image -->
      <div class="flex items-center gap-2">
        <button type="button" class="nav-btn" @click="scrollToSection('tags')">标签</button>
        <button type="button" class="nav-btn" @click="scrollToSection('info')">信息</button>
      </div>
    </div>

    <!-- 4.2 Immersive layout: image full-width, tags/info stacked below -->
    <div class="flex flex-col gap-8">

      <!-- Image (full-width, no card frame) -->
      <main class="min-w-0">
        <div style="animation: imageReveal var(--duration-slow) var(--ease-out);">
          <div class="relative rounded-[var(--radius-image)] overflow-hidden cursor-zoom-in" @click="openModal">
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
      </main>

      <!-- Title + Rating + Actions (below image, both desktop & mobile) -->
      <section class="flex flex-col gap-4">
        <div>
          <h1 v-if="post.title" class="text-2xl font-bold text-[var(--text-primary)] leading-snug mb-2" style="font-family: var(--font-display); letter-spacing: -0.01em; font-size: var(--font-size-title);">{{ post.title }}</h1>
          <div class="flex items-center gap-3 flex-wrap">
            <span class="inline-block px-2.5 py-0.5 rounded-full text-[0.6875rem] font-bold" :class="getRatingColorClass(post.rating)">{{ getRatingLabel(post.rating) }}</span>
            <span class="text-xs text-[var(--text-muted)]">{{ getSourceSiteLabel(post.source_site) }} · <span class="tabular-nums">{{ post.width }}×{{ post.height }}</span> · <span class="tabular-nums">{{ formatFileSize(post.file_size) }}</span></span>
          </div>
        </div>

        <!-- Description -->
        <div v-if="post.description" class="description text-sm text-[var(--text-primary)] leading-relaxed" v-html="post.description" />

        <!-- Info card -->
        <div id="info-section" class="dash-card !p-4 space-y-3 scroll-mt-20">
          <h2 class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
            图片信息
          </h2>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span class="text-[var(--text-muted)] text-xs block mb-0.5">来源</span>
              <a v-if="post.source_url" :href="post.source_url" target="_blank" rel="noopener noreferrer" class="gradient-text font-medium hover:underline text-xs">{{ getSourceSiteLabel(post.source_site) }} ↗</a>
              <span v-else class="text-xs">{{ getSourceSiteLabel(post.source_site) }}</span>
            </div>
            <div>
              <span class="text-[var(--text-muted)] text-xs block mb-0.5">尺寸</span>
              <span class="text-xs tabular-nums">{{ post.width }} × {{ post.height }}</span>
            </div>
            <div>
              <span class="text-[var(--text-muted)] text-xs block mb-0.5">文件大小</span>
              <span class="text-xs tabular-nums">{{ formatFileSize(post.file_size) }}</span>
            </div>
            <div>
              <span class="text-[var(--text-muted)] text-xs block mb-0.5">格式</span>
              <span class="text-xs">{{ post.mime_type }}</span>
            </div>
          </div>
          <div>
            <span class="text-[var(--text-muted)] text-xs block mb-0.5">添加时间</span>
            <span class="text-xs tabular-nums">{{ formatDate(post.created_at) }}</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-3 flex-wrap">
          <a :href="originalUrl" target="_blank" rel="noopener noreferrer" class="btn-primary">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            原图
          </a>
          <button
            v-if="isAdmin"
            type="button"
            class="btn-danger"
            :disabled="deleting"
            @click="deletePostAction"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
            {{ deleting ? '删除中…' : '删除' }}
          </button>
        </div>

        <!-- Admin rating editor -->
        <div v-if="isAdmin" class="flex items-center gap-2">
          <select v-model="selectedRating" class="text-xs px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)]">
            <option value="safe">公开</option>
            <option value="questionable">敏感</option>
            <option value="explicit">限制</option>
          </select>
          <button
            v-if="ratingSaveVisible"
            type="button"
            class="btn-primary !text-xs !px-2.5 !py-1.5"
            :disabled="saving"
            @click="saveRating"
          >{{ saving ? '保存中…' : '保存' }}</button>
          <span v-if="ratingMessage" class="text-xs text-[var(--text-muted)]">{{ ratingMessage }}</span>
        </div>
      </section>

      <!-- Tags (below image, both desktop & mobile — 4.2 stacked) -->
      <section id="tags-section" class="scroll-mt-20">
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
      </section>
    </div>

    <!-- Image Modal (delegates pan/zoom/pinch to <ImageModal>) -->
    <ImageModal v-model="showModal" :src="originalUrl" :alt="post.title || '原图'" />
  </div>
</template>

<style scoped>
.description :deep(a) {
  color: var(--accent-color);
  text-decoration: underline;
}
</style>
