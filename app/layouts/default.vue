<script setup lang="ts">
import type { SiteSettings } from '~/types'

const { siteSettings, isAdmin, ssrCookie } = useSsrContext()

// Initialize from SSR context
if (import.meta.server) {
  const ctx = useRequestEvent()?.context || {}
  isAdmin.value = ctx.isAdmin || false
  ssrCookie.value = ctx.ssrCookie || ''
  siteSettings.value = ctx.siteSettings || null
}

const settings = siteSettings as Ref<SiteSettings | null>
const siteTitle = computed(() => settings.value?.site_title || 'Kura Booru')
const siteDescription = computed(() => settings.value?.site_description || '个人动漫插画收藏与展示平台')
const announcement = computed(() => settings.value?.announcement || '')
const headInject = computed(() => settings.value?.head_inject || '')

// Global keyboard shortcuts (? toggles the cheatsheet modal below).
// ponytail: / focuses the first visible search input on the page via querySelector,
// avoiding the need to thread a ref from SearchBar (mounted in-page, not in layout) up to layout.
function goTags() { navigateTo('/tags') }
const { cheatsheetOpen } = useKeyboardShortcuts({ onGoTags: goTags })

// 4.3 Nav shrink on scroll (>100px → 56px→44px) + overflow menu state.
const navShrunk = ref(false)
const navMenuOpen = ref(false)
const route = useRoute()
const searchRouteQuery = computed(() => (route.query.q as string) || '')

let onScroll: (() => void) | null = null
let onNavClickOutside: ((e: MouseEvent) => void) | null = null

onMounted(() => {
  onScroll = () => { navShrunk.value = window.scrollY > 100 }
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })

  onNavClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('[data-nav-menu]')) navMenuOpen.value = false
  }
  document.addEventListener('click', onNavClickOutside)
})
onUnmounted(() => {
  if (onScroll) window.removeEventListener('scroll', onScroll)
  if (onNavClickOutside) document.removeEventListener('click', onNavClickOutside)
})

const { public: publicConfig } = useRuntimeConfig()
const gitTag = publicConfig.gitTag
const repoUrl = publicConfig.repoUrl || 'https://gitea.lainns.xyz/lainsaka/kura-booru-next'
// v0.9.0: AI toggle lives in the DB now — runtimeConfig.public.enableAiTagProcessing
// is a build-time snapshot that can't see admin changes. Read the flag from the
// public settings payload (SSR context) instead.
const enableAi = computed(() => settings.value?.ai_enabled === 'true')

// Accent hue from cookie (SSR anti-flash)
const accentCookie = useCookie('kura-accent-hue')
let accentHue = parseInt(accentCookie.value || '', 10)
if (isNaN(accentHue) || accentHue < 0 || accentHue > 360) accentHue = ACCENT_HUE_DEFAULT
const accentHueEnd = accentEndHue(accentHue)

// Platform detection for keycap display (⌘ vs Ctrl) — SSR anti-flash via cookie.
usePlatform()

const titleParts = computed(() => siteTitle.value.split(' '))
const gradientPart = computed(() => titleParts.value[0])
const mutedPart = computed(() => titleParts.value.slice(1).join(' '))

useHead({
  htmlAttrs: {
    // ponytail: theme class is set by the anti-flash inline script before paint;
    // setting it here would conflict with client-side theme detection and cause
    // a dark→light flash for light-theme users.
    style: `--accent-hue: ${accentHue}; --accent-hue-end: ${accentHueEnd};`,
  },
  title: siteTitle,
})

// Theme anti-flash inline script
useHead({
  script: [
    {
      innerHTML: `(function(){function a(){var s=localStorage.getItem('kura-theme-preference');var r;if(s==='light'||s==='dark'){r=s}else{r=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(r)}a();var u=new URLSearchParams(window.location.search).get('per_page');if(u){document.cookie='kura-per-page='+encodeURIComponent(u)+';path=/;max-age=31536000;samesite=lax'}})()`,
      type: 'text/javascript',
    },
  ],
})

// Inject head_inject — parse the HTML string into proper useHead entries.
// ponytail: innerHTML wraps content in a script tag, but head_inject is already
// a complete script element. Using innerHTML produces nested script tags
// which browsers can't parse. Instead, extract attrs from the HTML and pass them
// as proper script props so unhead renders the tag correctly.
const SCRIPT_OPEN_RE = /<scr\u0069pt\b([^>]*)>/gi
const ATTR_RE = /(\w[\w-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))/g
const SCRIPT_CLOSE = '<' + '/script>'

const headInjectEntries = computed(() => {
  // S7: head_inject is admin-trusted but still scope it to admin viewers —
  // anonymous visitors don't need analytics/tracking scripts.
  if (!isAdmin.value) return {}
  const html = headInject.value
  if (!html) return {}
  const scripts: Record<string, string>[] = []
  let m
  while ((m = SCRIPT_OPEN_RE.exec(html)) !== null) {
    const attrs: Record<string, string> = {}
    let am
    ATTR_RE.lastIndex = 0
    while ((am = ATTR_RE.exec(m[1]!)) !== null) {
      attrs[am[1]!] = am[2] ?? am[3] ?? am[4] ?? ''
    }
    if (attrs.src) {
      scripts.push(attrs)
    } else {
      const endIdx = html.indexOf(SCRIPT_CLOSE, m.index + m[0].length)
      const content = endIdx > 0 ? html.slice(m.index + m[0].length, endIdx) : ''
      scripts.push({ innerHTML: content, ...(attrs.type ? { type: attrs.type } : {}) })
    }
  }
  return scripts.length ? { script: scripts } : {}
})

useHead(headInjectEntries)
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Navigation (4.3 minimal: logo + large search + theme/accent on desktop;
         secondary entries collapse into a "..." overflow menu) -->
    <nav
      class="nav-glass sticky top-0 z-40 border-b border-[var(--border-color)] transition-[height,padding] duration-[var(--duration-fast)]"
      :class="navShrunk ? 'h-11' : 'h-14'"
      :style="{ '--nav-h': navShrunk ? '44px' : '56px' }"
    >
      <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 h-full">
        <div class="flex items-center justify-between h-full gap-4">
          <!-- Logo -->
          <NuxtLink to="/" class="flex items-center gap-2 group flex-shrink-0">
            <img src="/logo.svg" :alt="siteTitle" class="w-8 h-8 transition-all" :class="navShrunk ? 'h-7 w-7' : 'h-8 w-8'" />
            <span class="gradient-text font-bold hidden sm:inline transition-all" :class="navShrunk ? 'text-base' : 'text-xl'" style="letter-spacing: -0.02em; font-family: var(--font-display);">{{ gradientPart }}</span>
            <span v-if="mutedPart" class="text-[var(--text-muted)] font-light hidden sm:inline transition-all" :class="navShrunk ? 'text-base' : 'text-xl'" style="letter-spacing: -0.02em;">{{ mutedPart }}</span>
          </NuxtLink>

          <!-- Large search box (desktop, search-as-navigation) -->
          <div class="hidden md:block flex-1 max-w-xl mx-4">
            <SearchBar :initial-query="searchRouteQuery" placeholder="搜索标签..." />
          </div>

          <!-- Theme controls -->
          <div class="flex items-center gap-1 flex-shrink-0">
            <AccentPicker />
            <ThemeToggle />
            <!-- Overflow menu ("..."): secondary nav entries -->
            <div class="relative" data-nav-menu>
              <button
                type="button"
                @click="navMenuOpen = !navMenuOpen"
                class="w-9 h-9 rounded-[var(--radius-sm)] flex items-center justify-center transition-all hover:bg-[var(--accent-subtle)] active:scale-90"
                :class="navMenuOpen ? 'text-[var(--accent-color)]' : 'text-[var(--text-muted)]'"
                aria-label="更多"
                :aria-expanded="navMenuOpen"
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" /></svg>
              </button>
              <Transition name="nav-menu">
                <div
                  v-if="navMenuOpen"
                  class="absolute top-full right-0 mt-2 w-44 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-color)] shadow-lg overflow-hidden"
                >
                  <NuxtLink to="/search" class="block px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--accent-subtle)] transition-colors" @click="navMenuOpen = false">搜索</NuxtLink>
                  <NuxtLink to="/tags" class="block px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--accent-subtle)] transition-colors" @click="navMenuOpen = false">标签</NuxtLink>
                  <NuxtLink to="/random" class="block px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--accent-subtle)] transition-colors" @click="navMenuOpen = false">随机</NuxtLink>
                  <div class="border-t border-[var(--border-color)]" />
                  <template v-if="isAdmin">
                    <NuxtLink to="/admin?tab=dashboard" class="block px-4 py-3 text-sm text-[var(--accent-color)] hover:bg-[var(--accent-subtle)] transition-colors" @click="navMenuOpen = false">管理后台</NuxtLink>
                    <form action="/logout" method="post" class="contents">
                      <button type="submit" class="block w-full text-left px-4 py-3 text-sm text-[var(--color-danger)] hover:bg-[var(--accent-subtle)] transition-colors">退出</button>
                    </form>
                  </template>
                  <NuxtLink v-else to="/login" class="block px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--accent-subtle)] transition-colors" @click="navMenuOpen = false">登录</NuxtLink>
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <!-- Announcement banner -->
    <AnnouncementBanner v-if="announcement" :content="announcement" />

    <!-- Main content -->
    <main class="flex-1 relative z-2">
      <slot />
    </main>

    <!-- Footer -->
    <footer class="border-t border-[var(--border-color)] py-6 mt-12 relative z-2">
      <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8">
        <div class="flex flex-wrap items-center justify-between gap-y-2 text-sm text-[var(--text-muted)]">
          <span class="inline-flex items-center gap-2">
            <NuxtLink :to="repoUrl" target="_blank" rel="noopener noreferrer" class="gradient-text font-medium hover:opacity-80 transition-opacity">{{ siteTitle }} (Next)</NuxtLink>
            <span class="inline-flex items-center px-2 py-0.5 rounded-full border border-[var(--border-color)] font-mono text-[0.6875rem]">{{ gitTag }}</span>
            <span v-if="enableAi" class="inline-flex items-center px-2 py-0.5 rounded-full border border-[var(--color-warning)]/30 text-[var(--color-warning)] font-mono text-[0.6875rem]">AI &#10022;</span>
          </span>
          <span>{{ siteDescription }}</span>
        </div>
      </div>
    </footer>

    <!-- Mobile bottom tab bar -->
    <BottomTabBar :is-admin="isAdmin" />

    <!-- Keyboard shortcuts cheatsheet (? to toggle) -->
    <KbdCheatSheet v-model="cheatsheetOpen" />

    <!-- Global toast + confirm dialog (admin + user-facing) -->
    <ToastContainer />
    <ConfirmDialog />
  </div>
</template>

<style scoped>
.nav-menu-enter-active, .nav-menu-leave-active {
  transition: all 0.2s var(--ease-out);
}
.nav-menu-enter-from, .nav-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}
</style>
