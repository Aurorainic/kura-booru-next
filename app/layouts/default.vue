<script setup lang="ts">
import type { SiteSettings } from '~/types'

const { siteSettings, isAdmin, ssrCookie, intranetMode } = useSsrContext()

// Initialize from SSR context
if (import.meta.server) {
  const ctx = useRequestEvent()?.context || {}
  isAdmin.value = ctx.isAdmin || false
  intranetMode.value = ctx.intranetMode || false
  ssrCookie.value = ctx.ssrCookie || ''
  const settings = ctx.siteSettings || null
  if (settings && settings.intranet_mode === undefined) {
    settings.intranet_mode = String(!!ctx.intranetMode)
  }
  siteSettings.value = settings
}

const settings = siteSettings as Ref<SiteSettings | null>
const siteTitle = computed(() => settings.value?.site_title || 'Kura Booru')
const siteDescription = computed(() => settings.value?.site_description || '个人动漫插画收藏与展示平台')
const announcement = computed(() => settings.value?.announcement || '')
const headInject = computed(() => settings.value?.head_inject || '')

// Global keyboard shortcuts (? toggles the cheatsheet modal below).
function goTags() { navigateTo('/tags') }
const { cheatsheetOpen } = useKeyboardShortcuts({ onGoTags: goTags })

// Nav shrinks on scroll (>100px → 56px→44px); overflow menu state.
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
// AI toggle lives in the DB — runtimeConfig is a build-time snapshot; read it from the public settings payload instead.
const enableAi = computed(() => settings.value?.ai_enabled === 'true')
// Site-wide import entry: public mode → logged-in admins only; intranet mode → everyone.
const showImport = computed(() => isAdmin.value || intranetMode.value)

// Nav behavior keys on desktop-class UAs, not viewport width: mobile keeps icon-only controls without hover labels.
const MOBILE_UA_RE = /(?:Mobi|iPhone|iPod|iPad|Windows Phone|BlackBerry|Opera Mini|IEMobile|Android(?=.*Mobile))/i
const isNonMobileUA = ref(true)
if (import.meta.server) {
  const headers = useRequestHeaders(['user-agent'])
  isNonMobileUA.value = !MOBILE_UA_RE.test(headers['user-agent'] || '')
} else {
  isNonMobileUA.value = !MOBILE_UA_RE.test(navigator.userAgent)
}

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
const SCRIPT_OPEN_RE = /<scr\u0069pt\b([^>]*)>/gi
const ATTR_RE = /(\w[\w-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))/g
const SCRIPT_CLOSE = '<' + '/script>'

const headInjectEntries = computed<import('@unhead/vue').ReactiveHead>(() => {
  // S7: head_inject is admin-trusted but still scoped to admin viewers — anon visitors don't need tracking scripts.
  if (!isAdmin.value) return {}
  const html = headInject.value
  if (!html) return {}
  const scripts: any[] = []
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
    <!-- Nav (4.3 minimal): logo + large search + theme/accent on desktop; secondary entries in "..." menu -->
    <nav
      class="nav-glass sticky top-0 z-40 border-b border-[var(--border-color)] transition-[height,padding] duration-[var(--duration-fast)]"
      :class="navShrunk ? 'h-11' : 'h-14'"
      :style="{ '--nav-h': navShrunk ? '44px' : '56px' }"
    >
      <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 h-full">
        <div class="flex items-center justify-between h-full gap-4">
          <NuxtLink to="/" class="flex items-center gap-2 group flex-shrink-0">
            <img src="/logo.svg" :alt="siteTitle" class="w-8 h-8 transition-all" :class="navShrunk ? 'h-7 w-7' : 'h-8 w-8'" />
            <span class="gradient-text font-bold hidden sm:inline transition-all" :class="navShrunk ? 'text-base' : 'text-xl'" style="letter-spacing: -0.02em; font-family: var(--font-display);">{{ gradientPart }}</span>
            <span v-if="mutedPart" class="text-[var(--text-muted)] font-light hidden sm:inline transition-all" :class="navShrunk ? 'text-base' : 'text-xl'" style="letter-spacing: -0.02em;">{{ mutedPart }}</span>
          </NuxtLink>

          <div class="hidden md:block flex-1 max-w-xl mx-4">
            <SearchBar :initial-query="searchRouteQuery" placeholder="搜索标签..." />
          </div>

          <div class="flex items-center gap-1 flex-shrink-0">
            <template v-if="isNonMobileUA">
              <div class="relative nav-expand-action" data-accent-picker>
                <AccentPicker />
                <span class="nav-expand-label">色调</span>
              </div>
              <div class="relative nav-expand-action">
                <ThemeToggle :compact="true" />
                <span class="nav-expand-label">明暗</span>
              </div>
              <!-- Import entry: admins only in public mode, everyone in intranet mode -->
              <div v-if="showImport" class="relative nav-expand-action">
                <NuxtLink
                  to="/admin?tab=import"
                  class="h-9 w-9 rounded-[var(--radius-sm)] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-color)] hover:bg-[var(--accent-subtle)] transition-all active:scale-90"
                  aria-label="批量导入"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                </NuxtLink>
                <span class="nav-expand-label">导入</span>
              </div>
            </template>
            <template v-else>
              <AccentPicker />
              <ThemeToggle />
              <NuxtLink
                v-if="showImport"
                to="/admin?tab=import"
                class="h-9 px-3 rounded-[var(--radius-sm)] inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent-color)] hover:bg-[var(--accent-subtle)] transition-all active:scale-90"
                aria-label="批量导入"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                <span>导入</span>
              </NuxtLink>
            </template>
            <!-- Overflow menu ("...") for secondary nav entries -->
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
                  </template>
                  <template v-if="!intranetMode">
                    <form v-if="isAdmin" action="/logout" method="post" class="contents">
                      <button type="submit" class="block w-full text-left px-4 py-3 text-sm text-[var(--color-danger)] hover:bg-[var(--accent-subtle)] transition-colors">退出</button>
                    </form>
                    <NuxtLink v-else to="/login" class="block px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--accent-subtle)] transition-colors" @click="navMenuOpen = false">登录</NuxtLink>
                  </template>
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <AnnouncementBanner v-if="announcement" :content="announcement" />

    <main class="flex-1 relative z-2">
      <slot />
    </main>

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

    <BottomTabBar :is-admin="isAdmin" :intranet-mode="intranetMode" />

    <!-- Keyboard shortcuts cheatsheet (? toggles) -->
    <KbdCheatSheet v-model="cheatsheetOpen" />

    <!-- Global toast + confirm dialog -->
    <ToastContainer />
    <ConfirmDialog />
  </div>
</template>

<style scoped>
.nav-expand-action {
  position: relative;
  flex-shrink: 0;
}

.nav-expand-label {
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  transform: translate(-4px, -50%);
  z-index: 60;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s var(--ease-out), transform 0.16s var(--ease-out);
}

.nav-expand-action:hover .nav-expand-label,
.nav-expand-action:focus-within .nav-expand-label {
  opacity: 1;
  transform: translate(0, -50%);
}

.nav-menu-enter-active, .nav-menu-leave-active {
  transition: all 0.2s var(--ease-out);
}
.nav-menu-enter-from, .nav-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}
</style>
