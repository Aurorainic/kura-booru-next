// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV !== 'production' },

  css: ['~/../assets/css/main.css'],

  components: { dirs: [{ path: '~/components', pathPrefix: false }] },

  vite: {
    plugins: [tailwindcss()],
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0, viewport-fit=cover' },
        { name: 'theme-color', content: '#7DD3C0' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },

  runtimeConfig: {
    internalApiUrl: process.env.INTERNAL_API_URL || 'http://127.0.0.1:3000/api',
    // Server-only: gates AI tagging job dispatch. Kept out of `public` so the toggle never reaches the browser bundle.
    enableAiTagProcessing: process.env.ENABLE_AI_TAG_PROCESSING || 'false',
    public: {
      gitTag: process.env.KURA_VERSION || process.env.PUBLIC_GIT_TAG || 'dev',
      repoUrl: process.env.PUBLIC_REPO_URL || '',
    },
  },

  routeRules: {
    // SSR HTML cache is owned by server/middleware/02-cache-control.ts (anon → s-maxage=300, admin → no-store, Redis-down → no-store fail-closed).
    // Do NOT add `swr: 300` back: v0.7.2's URL-only SWR cache served stale anon HTML to just-logged-in admins.
    // Route-level no-store below is a belt-and-suspenders guard for proxies that ignore Vary: Cookie.
    '/admin/**': { headers: { 'cache-control': 'private, no-store' } },
    '/login': { headers: { 'cache-control': 'private, no-store' } },
    '/logout': { headers: { 'cache-control': 'private, no-store' } },
  },
})
