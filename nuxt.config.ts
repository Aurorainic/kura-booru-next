// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // ponytail: devtools 静态配置不随 NODE_ENV 自动关闭。Nuxt 在 schema 解析阶段
  // 读取 devtools.enabled，此时 Docker build 阶段 NODE_ENV 默认为 undefined（非
  // production），于是 @nuxt/devtools 被注册进客户端产物——升级后线上又冒出浮窗。
  // 根因是构建期 NODE_ENV 未设，而非配置本身。这里保留显式判断做兜底，但真正
  // 的修复在 Dockerfile build 阶段注入 NODE_ENV=production（见 commit）。
  devtools: { enabled: process.env.NODE_ENV !== 'production' },

  css: ['~/../assets/css/main.css'],

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
    public: {
      gitTag: process.env.KURA_VERSION || process.env.PUBLIC_GIT_TAG || 'dev',
      repoUrl: process.env.PUBLIC_REPO_URL || '',
      enableAiTagProcessing: process.env.ENABLE_AI_TAG_PROCESSING || 'false',
    },
  },

  routeRules: {
    // SSR HTML cache is fully controlled by
    // server/middleware/02-cache-control.ts, which inspects the request
    // cookie on every SSR: anon → `public, s-maxage=300` (CDN-cacheable),
    // admin → `private, no-store` (never cached), Redis-down → no-store
    // (fail-closed to avoid leaking admin HTML).
    //
    // Do NOT add `swr: 300` back here. v0.7.2 introduced Nitro's in-process
    // SWR cache keyed on URL only — no cookie in the cache key — so the anon
    // HTML Nitro cached for `/` was served back to a just-logged-in admin on
    // full page reload (login.vue does `window.location.href = '/'`), leaving
    // them in the stale `isAdmin=false` state. The middleware can't undo this
    // because SWR short-circuits the request in the Nitro hook chain before
    // any middleware runs.
    //
    // Admin/login/logout paths stay explicitly no-store at the route level too,
    // as a belt-and-suspenders guard for any proxy that ignores Vary: Cookie.
    '/admin/**': { headers: { 'cache-control': 'private, no-store' } },
    '/login': { headers: { 'cache-control': 'private, no-store' } },
    '/logout': { headers: { 'cache-control': 'private, no-store' } },
  },
})
