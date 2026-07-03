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

const { public: publicConfig } = useRuntimeConfig()
const gitTag = publicConfig.gitTag
const repoUrl = publicConfig.repoUrl || 'https://gitea.lainns.xyz/lainsaka/kura-booru-next'
const enableAi = publicConfig.enableAiTagProcessing === 'true'

// Accent hue from cookie (SSR anti-flash)
const accentCookie = useCookie('kura-accent-hue')
let accentHue = parseInt(accentCookie.value || '', 10)
if (isNaN(accentHue) || accentHue < 0 || accentHue > 360) accentHue = 175
const accentHueEnd = accentHue + 25

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
// ponytail: innerHTML wraps content in a <script> tag, but head_inject is already
// a complete <script ...></script>. Using innerHTML produces <script><script ...>
// which browsers can't parse. Instead, extract attrs from the HTML and pass them
// as proper script props so unhead renders the tag correctly.
const headInjectEntries = computed(() => {
  const html = headInject.value
  if (!html) return {}
  const scripts: Record<string, string>[] = []
  // Match <script ...> opening tags — extract their attributes
  const scriptRe = /<script\b([^>]*)>/gi
  let m
  while ((m = scriptRe.exec(html)) !== null) {
    const attrs: Record<string, string> = {}
    const attrRe = /(\w[\w-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))/g
    let am
    while ((am = attrRe.exec(m[1]!)) !== null) {
      attrs[am[1]!] = am[2] ?? am[3] ?? am[4] ?? ''
    }
    if (attrs.src) {
      // External script: pass attrs directly (defer, async, src, data-*, etc.)
      scripts.push(attrs)
    } else {
      // Inline script: extract content between <script>...</script>
      const endIdx = html.indexOf('<' + '/script>', m.index + m[0].length)
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
    <!-- Navigation -->
    <nav class="nav-glass sticky top-0 z-40 border-b border-[var(--border-color)]" :style="{ '--nav-h': '56px' }">
      <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8">
        <div class="flex items-center justify-between h-14 gap-4">
          <!-- Logo -->
          <NuxtLink to="/" class="flex items-center gap-2 group flex-shrink-0">
            <img src="/logo.svg" :alt="siteTitle" class="h-8 w-8" />
            <span class="gradient-text text-xl font-bold hidden sm:inline" style="letter-spacing: -0.02em; font-family: var(--font-display);">{{ gradientPart }}</span>
            <span v-if="mutedPart" class="text-[var(--text-muted)] text-xl font-light hidden sm:inline" style="letter-spacing: -0.02em;">{{ mutedPart }}</span>
          </NuxtLink>

          <!-- Nav links (desktop) -->
          <div class="hidden md:flex items-center gap-1">
            <NuxtLink
              to="/search"
              class="nav-btn"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
              搜索
            </NuxtLink>
            <NuxtLink
              to="/tags"
              class="nav-btn"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 8.25h13.5M5.25 8.25V18a2.25 2.25 0 0 0 2.25 2.25h10.5A2.25 2.25 0 0 0 20.25 18V8.25m-15 0V6a2.25 2.25 0 0 1 2.25-2.25h10.5A2.25 2.25 0 0 1 20.25 6v2.25m-15 0h13.5" /></svg>
              标签
            </NuxtLink>
            <NuxtLink
              to="/random"
              class="nav-btn"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9a5.5 5.5 0 01-3.8-2.6l-.5-.8M18 14l4 4-4 4" /></svg>
              随机
            </NuxtLink>
            <div class="w-px h-5 bg-[var(--border-color)]" />
            <template v-if="isAdmin">
              <NuxtLink
                to="/admin?tab=dashboard"
                class="nav-btn"
                style="color: var(--accent-color);"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>
                管理后台
              </NuxtLink>
              <form action="/logout" method="post" class="contents">
                <button type="submit" class="nav-btn" style="color: var(--color-danger);">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" /></svg>
                  退出
                </button>
              </form>
            </template>
            <NuxtLink
              v-else
              to="/login"
              class="nav-btn"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
              登录
            </NuxtLink>
          </div>

          <!-- Theme controls -->
          <div class="flex items-center gap-1">
            <AccentPicker />
            <ThemeToggle />
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
  </div>
</template>
