<script setup lang="ts">
import { defineAsyncComponent } from 'vue'

const { isAdmin, ssrCookie } = useSsrContext()
const route = useRoute()

if (!isAdmin.value) {
  throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
}

const tabs = [
  { key: 'dashboard', label: '概览' },
  { key: 'posts', label: '图片' },
  { key: 'tags', label: '标签' },
  { key: 'auto-rating', label: '自动评级' },
  { key: 'ai', label: 'AI 助手' },
  { key: 'extension', label: '扩展密钥' },
  { key: 'settings', label: '设置' },
  { key: 'password', label: '密码' },
]

const currentTab = computed(() => (route.query.tab as string) || 'dashboard')

function switchTab(tab: string) {
  navigateTo(`/admin?tab=${tab}`)
}

// Route-level code splitting — only load the active panel
const DashboardPanel = defineAsyncComponent(() => import('~/components/admin/DashboardPanel.vue'))
const PostsPanel = defineAsyncComponent(() => import('~/components/admin/PostsPanel.vue'))
const TagsPanel = defineAsyncComponent(() => import('~/components/admin/TagsPanel.vue'))
const AutoRatingPanel = defineAsyncComponent(() => import('~/components/admin/AutoRatingPanel.vue'))
const AiAssistantPanel = defineAsyncComponent(() => import('~/components/admin/AiAssistantPanel.vue'))
const ExtensionKeysPanel = defineAsyncComponent(() => import('~/components/admin/ExtensionKeysPanel.vue'))
const SettingsPanel = defineAsyncComponent(() => import('~/components/admin/SettingsPanel.vue'))
const PasswordPanel = defineAsyncComponent(() => import('~/components/admin/PasswordPanel.vue'))
</script>

<template>
  <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 py-6" style="padding-top: var(--space-page-top);">
    <h1 class="gradient-text mb-6" style="font-size: var(--font-size-display); font-weight: 700; font-family: var(--font-display);">管理后台</h1>

    <!-- Tab navigation -->
    <div class="flex items-center gap-4 mb-8 border-b border-[var(--border-color)] pb-2 overflow-x-auto">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        @click="switchTab(tab.key)"
        class="filter-pill whitespace-nowrap"
        :class="{ active: currentTab === tab.key }"
      >{{ tab.label }}</button>
    </div>

    <!-- Tab content -->
    <div>
      <DashboardPanel v-if="currentTab === 'dashboard'" />
      <PostsPanel v-else-if="currentTab === 'posts'" />
      <TagsPanel v-else-if="currentTab === 'tags'" />
      <AutoRatingPanel v-else-if="currentTab === 'auto-rating'" />
      <AiAssistantPanel v-else-if="currentTab === 'ai'" />
      <ExtensionKeysPanel v-else-if="currentTab === 'extension'" />
      <SettingsPanel v-else-if="currentTab === 'settings'" />
      <PasswordPanel v-else-if="currentTab === 'password'" />
    </div>
  </div>
</template>
