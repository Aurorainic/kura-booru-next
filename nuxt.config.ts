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
    // Anon gallery + tag + search SSR — 300s stale-while-revalidate cache.
    // Cache key excludes cookies on purpose: anon visitors see the same HTML
    // for the same (rating, page, q). Admin paths are gated by private/no-store
    // headers in server/middleware/02-cache-control.ts and never reach here.
    // ponytail: nitro cache is in-process, NOT shared across replicas — fine
    // for a single-web-instance deployment. Multi-replica would need a redis
    // driver hook here.
    '/posts/**': { swr: 300, headers: { 'cache-control': 'public, s-maxage=300' } },
    '/tags/**': { swr: 300, headers: { 'cache-control': 'public, s-maxage=300' } },
    '/search': { swr: 300, headers: { 'cache-control': 'public, s-maxage=300' } },
    // Admin, login, settings, and any authed path — never cached.
    '/admin/**': { headers: { 'cache-control': 'private, no-store' } },
    '/login': { headers: { 'cache-control': 'private, no-store' } },
  },
})
