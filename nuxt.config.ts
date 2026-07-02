// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // ponytail: devtools 静态配置不随 NODE_ENV 自动关闭，prod 构建仍会打进客户端产物，
  // 手机端 viewport 窄反而触发浮窗显示。按环境显式关闭。
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
})
