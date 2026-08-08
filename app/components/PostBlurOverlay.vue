<script setup lang="ts">
import type { Post } from '~/types'

withDefaults(defineProps<{
  post: Post
  blurred?: boolean
}>(), { blurred: true })

const revealed = ref(false)

function reveal() {
  revealed.value = true
}
</script>

<template>
  <template v-if="blurred">
    <div
      class="post-blur-overlay relative w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-color)] bg-[var(--bg-alt)]"
      :style="{ aspectRatio: `${post.width} / ${post.height}` }"
    >
      <!-- 遮挡层：点击后展开原图 -->
      <button
        v-if="!revealed"
        type="button"
        class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 w-full h-full p-4 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]"
        :aria-label="`内容已隐藏（${getRatingLabel(post.rating)}），点击查看`"
        @click.stop="reveal"
      >
        <span
          class="inline-flex items-center px-2.5 py-1 rounded text-xs font-bold border"
          :class="getRatingColorClass(post.rating)"
        >
          {{ getRatingLabel(post.rating) }}
        </span>
        <span class="text-sm text-[var(--text-muted)]">内容已隐藏（安全模式）</span>
        <span class="text-xs text-[var(--text-primary)] underline underline-offset-2">点击查看</span>
      </button>

      <!-- 展开后的真实内容 -->
      <div v-else class="absolute inset-0 w-full h-full">
        <slot />
      </div>
    </div>
  </template>
  <template v-else>
    <slot />
  </template>
</template>
