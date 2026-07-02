<script setup lang="ts">
defineProps<{
  isAdmin?: boolean
}>()

const route = useRoute()

const tabs = [
  { to: '/', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: '画廊' },
  { to: '/search', icon: 'm21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z', label: '搜索' },
  { to: '/random', icon: 'M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9a5.5 5.5 0 01-3.8-2.6l-.5-.8M18 14l4 4-4 4', label: '随机' },
]

const showMenu = ref(false)

function toggleMenu() {
  showMenu.value = !showMenu.value
}

let clickOutsideHandler: ((e: MouseEvent) => void) | null = null

onMounted(() => {
  clickOutsideHandler = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('[data-menu-tab]')) showMenu.value = false
  }
  document.addEventListener('click', clickOutsideHandler)
})

onUnmounted(() => {
  if (clickOutsideHandler) document.removeEventListener('click', clickOutsideHandler)
})
</script>

<template>
  <nav class="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-surface)] border-t border-[var(--border-color)]" style="padding-bottom: env(safe-area-inset-bottom);">
    <div class="flex items-center justify-around h-14">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative transition-colors"
        :class="route.path === tab.to ? 'text-[var(--accent-color)]' : 'text-[var(--text-muted)]'"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path :d="tab.icon" />
        </svg>
        <span class="text-[0.625rem] font-medium">{{ tab.label }}</span>
        <span
          v-if="route.path === tab.to"
          class="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[var(--accent-color)]"
        />
      </NuxtLink>

      <!-- Menu tab -->
      <div class="relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full" data-menu-tab>
        <button
          type="button"
          @click="toggleMenu"
          class="flex flex-col items-center justify-center gap-0.5 h-full w-full transition-colors"
          :class="showMenu ? 'text-[var(--accent-color)]' : 'text-[var(--text-muted)]'"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span class="text-[0.625rem] font-medium">菜单</span>
        </button>

        <Transition name="menu-panel">
          <div
            v-if="showMenu"
            class="absolute bottom-full right-0 mb-2 w-44 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-color)] shadow-lg overflow-hidden"
          >
            <NuxtLink to="/tags" class="block px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--accent-subtle)] transition-colors">标签</NuxtLink>
            <template v-if="isAdmin">
              <div class="border-t border-[var(--border-color)]" />
              <NuxtLink to="/admin?tab=dashboard" class="block px-4 py-3 text-sm text-[var(--accent-color)] hover:bg-[var(--accent-subtle)] transition-colors">管理后台</NuxtLink>
              <form action="/logout" method="post" class="contents">
                <button type="submit" class="block w-full text-left px-4 py-3 text-sm text-[var(--color-danger)] hover:bg-[var(--accent-subtle)] transition-colors">退出登录</button>
              </form>
            </template>
            <template v-else>
              <div class="border-t border-[var(--border-color)]" />
              <NuxtLink to="/login" class="block px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--accent-subtle)] transition-colors">登录</NuxtLink>
            </template>
          </div>
        </Transition>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.menu-panel-enter-active, .menu-panel-leave-active {
  transition: all 0.2s var(--ease-out);
}
.menu-panel-enter-from, .menu-panel-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
