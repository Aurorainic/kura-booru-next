<script setup lang="ts">
useHead({ title: '维护中' })
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <div class="text-center" style="animation: searchIn var(--duration-slow) var(--ease-out);">
      <div class="mb-6">
        <svg class="w-20 h-20 mx-auto text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.19c.345-.439.69-.86 1.05-1.249m-3.546 4.439-4.293 4.293a1 1 0 0 1-1.414 0L3 18.172V15h3.172l1.586 1.586a1 1 0 0 1 0 1.414l-1.586 1.586Z" />
        </svg>
      </div>
      <h1 class="gradient-text mb-3" style="font-size: var(--font-size-display); font-weight: 700; font-family: var(--font-display);">维护中</h1>
      <p class="text-[var(--text-muted)] mb-6">网站正在维护，请稍后再来。</p>
      <NuxtLink to="/login" class="filter-pill">管理员登录</NuxtLink>
    </div>
  </div>
</template>
