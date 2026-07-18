<script setup lang="ts">
import { defineAsyncComponent } from 'vue'

const { isAdmin, ssrCookie } = useSsrContext()
const route = useRoute()

if (!isAdmin.value) {
  throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
}

const tabs = [
  { key: 'dashboard', label: '概览', icon: 'M2.25 12 11.204 3.045c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25' },
  { key: 'posts', label: '图片', icon: 'm2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z' },
  { key: 'tags', label: '标签', icon: 'M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z' },
  { key: 'auto-rating', label: '自动评级', icon: 'M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5z' },
  { key: 'ai', label: 'AI 助手', icon: 'M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z' },
  { key: 'extension', label: '扩展密钥', icon: 'M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.995-6.995c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z' },
  { key: 'settings', label: '设置', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.003-.827c.293-.241.438-.613.43-.992a7.723 7.723 0 0 1 0-.255c.008-.378-.137-.75-.43-.991l-1.003-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z' },
  { key: 'password', label: '密码', icon: 'M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z' },
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

// ponytail: component lookup for keep-alive include list — must match the
// panel's `name` option. defineAsyncComponent preserves the underlying name.
const panelMap: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  dashboard: DashboardPanel,
  posts: PostsPanel,
  tags: TagsPanel,
  'auto-rating': AutoRatingPanel,
  ai: AiAssistantPanel,
  extension: ExtensionKeysPanel,
  settings: SettingsPanel,
  password: PasswordPanel,
}
</script>

<template>
  <div class="max-w-[var(--content-max)] mx-auto px-4 lg:px-8 py-6" style="padding-top: var(--space-page-top);">
    <h1 class="gradient-text mb-2" style="font-size: var(--font-size-display); font-weight: 700; font-family: var(--font-display);">管理后台</h1>

    <!-- Consolidated status bar (queue depth + AI status) -->
    <AdminStatusBar class="mb-2" />

    <!-- Tab navigation -->
    <div
      class="flex items-center gap-2 mb-6 border-b border-[var(--border-color)] pb-1 overflow-x-auto admin-tab-scroll"
    >
      <button
        v-for="tab in tabs"
        :key="tab.key"
        @click="switchTab(tab.key)"
        class="admin-tab whitespace-nowrap inline-flex items-center gap-1.5"
        :class="{ active: currentTab === tab.key }"
      >
        <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" :d="tab.icon" /></svg>
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <!-- Tab content — keep-alive preserves panel state across tab switches -->
    <div>
      <KeepAlive>
        <component :is="panelMap[currentTab] || panelMap.dashboard" />
      </KeepAlive>
    </div>
  </div>
</template>

<style scoped>
/* ponytail: admin tabs need horizontal padding + bigger gap than .filter-pill
   (which is padding:4px 0 and designed for tight tag-row density). Without
   padding the icons + labels felt cramped against each other and against
   the row's neighbors. */
.admin-tab {
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 500;
  position: relative;
  transition: color var(--duration-instant), background var(--duration-fast);
  cursor: pointer;
  border: none;
  background: none;
  text-decoration: none;
}
.admin-tab:hover {
  color: var(--accent-color);
  background: var(--accent-subtle);
}
.admin-tab.active {
  color: var(--accent-color);
  font-weight: 600;
}
.admin-tab.active::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -1px;
  height: 2px;
  background: var(--accent-color);
  border-radius: 2px;
}

/* Mobile horizontal scroll with snap + hidden scrollbar */
.admin-tab-scroll {
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}
.admin-tab-scroll::-webkit-scrollbar {
  display: none;
}
.admin-tab-scroll > button {
  scroll-snap-align: start;
}
</style>
