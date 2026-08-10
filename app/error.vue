<script setup lang="ts">
const props = defineProps<{ error: { statusCode: number; message: string } }>()

const error = computed(() => props.error)
const handleError = () => clearError({ redirect: '/' })

useHead({ title: `${props.error.statusCode} — 页面未找到` })
</script>

<template>
  <NuxtLayout>
    <div class="min-h-screen flex items-center justify-center px-4">
      <div class="text-center" style="animation: searchIn var(--duration-slow) var(--ease-out);">
        <h1 class="gradient-text mb-3" style="font-size: var(--font-size-display); font-weight: 700; font-family: var(--font-display);">{{ error.statusCode }}</h1>
        <p class="text-[var(--text-muted)] mb-6">{{ error.statusCode === 404 ? '页面未找到' : '出错了' }}</p>
        <button type="button" class="filter-pill" @click="handleError">← 返回首页</button>
      </div>
    </div>
  </NuxtLayout>
</template>
