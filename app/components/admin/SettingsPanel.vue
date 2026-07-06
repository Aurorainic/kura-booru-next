<script setup lang="ts">
import type { SiteSettings } from '~/types'
const { ssrCookie } = useSsrContext()

const siteTitle = ref('')
const siteDescription = ref('')
const announcement = ref('')
const headInject = ref('')
const maintenanceMode = ref(false)
const saving = ref(false)
const saved = ref(false)

// Infrastructure settings
const dbUrl = ref('')
const redisUrl = ref('')
const dbTestResult = ref<{ ok?: boolean; error?: string } | null>(null)
const redisTestResult = ref<{ ok?: boolean; error?: string } | null>(null)
const testingDb = ref(false)
const testingRedis = ref(false)

// Load current settings
const { data: settings } = await useAsyncData('admin-settings', async () => {
  try {
    const [pub, admin] = await Promise.all([
      fetchPublicSettings(ssrCookie.value),
      fetchAdminSettings(ssrCookie.value),
    ])
    return { ...pub, ...admin } as SiteSettings & { database_url?: string; redis_url?: string }
  } catch {
    return null
  }
})

watch(settings, (val) => {
  if (val) {
    siteTitle.value = val.site_title || ''
    siteDescription.value = val.site_description || ''
    announcement.value = val.announcement || ''
    headInject.value = val.head_inject || ''
    maintenanceMode.value = val.maintenance_mode === 'true'
    dbUrl.value = val.database_url || ''
    redisUrl.value = val.redis_url || ''
  }
}, { immediate: true })

async function save() {
  saving.value = true
  saved.value = false
  try {
    await $fetch('/api/admin/settings/', {
      method: 'PUT',
      credentials: 'include',
      body: {
        settings: {
          site_title: siteTitle.value,
          site_description: siteDescription.value,
          announcement: announcement.value,
          head_inject: headInject.value,
          maintenance_mode: maintenanceMode.value ? 'true' : 'false',
        },
      },
    })
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
  } catch {
    alert('保存失败')
  } finally {
    saving.value = false
  }
}

async function testDb() {
  testingDb.value = true
  dbTestResult.value = null
  try {
    dbTestResult.value = await testPgConnection(dbUrl.value)
  } catch (e: any) {
    dbTestResult.value = { ok: false, error: e.message || '连接失败' }
  } finally {
    testingDb.value = false
  }
}

async function testRedis() {
  testingRedis.value = true
  redisTestResult.value = null
  try {
    redisTestResult.value = await testRedisConnection(redisUrl.value)
  } catch (e: any) {
    redisTestResult.value = { ok: false, error: e.message || '连接失败' }
  } finally {
    testingRedis.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <!-- Site settings -->
    <div>
      <h2 class="text-lg font-bold tracking-tight mb-1" style="font-family: var(--font-display);">站点设置</h2>
      <p class="text-xs text-[var(--text-muted)] mb-4">全局站点配置，变更立即生效。</p>
      <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-5 space-y-4">
        <div>
          <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">站点标题</label>
          <input v-model="siteTitle" type="text" class="w-full px-3 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }" />
        </div>
        <div>
          <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">站点描述</label>
          <input v-model="siteDescription" type="text" class="w-full px-3 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }" />
        </div>
        <div>
          <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">公告内容</label>
          <textarea v-model="announcement" rows="3" class="w-full px-3 py-2.5 rounded-xl border text-sm transition-colors resize-none focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }" />
          <p class="text-[0.625rem] text-[var(--text-muted)] mt-1">支持 Markdown。多行轮播，溢出水平滚动。</p>
        </div>
        <div>
          <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">Head 注入</label>
          <textarea v-model="headInject" rows="3" class="w-full px-3 py-2.5 rounded-xl border text-sm transition-colors resize-none focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }" />
          <p class="text-[0.625rem] text-[var(--text-muted)] mt-1">注入到 &lt;head&gt; 的 HTML（如分析脚本）。</p>
        </div>
        <label class="flex items-center gap-3 py-1 cursor-pointer">
          <input v-model="maintenanceMode" type="checkbox" class="w-4 h-4 rounded accent-[var(--accent-color)]" />
          <span class="text-sm text-[var(--text-primary)]">维护模式</span>
          <span class="text-xs text-[var(--text-muted)]">非管理员将被重定向到维护页面</span>
        </label>
        <div class="flex items-center gap-3 pt-1">
          <button @click="save" :disabled="saving" class="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 disabled:opacity-50" style="background: var(--accent-color); color: var(--bg-primary);">
            {{ saving ? '保存中…' : '保存更改' }}
          </button>
          <Transition name="fade">
            <span v-if="saved" class="text-sm font-medium text-[var(--color-success)]">✓ 已保存</span>
          </Transition>
        </div>
      </div>
    </div>

    <!-- Infrastructure -->
    <div>
      <h2 class="text-lg font-bold tracking-tight mb-1" style="font-family: var(--font-display);">基础设施</h2>
      <p class="text-xs text-[var(--text-muted)] mb-4">数据库和缓存连接配置。修改后需重启服务生效。</p>
      <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-5 space-y-4">
        <div>
          <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">Database URL</label>
          <div class="flex gap-2">
            <input v-model="dbUrl" type="text" class="flex-1 px-3 py-2.5 rounded-xl border text-sm font-mono transition-colors focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }" placeholder="postgres://..." />
            <button @click="testDb" :disabled="testingDb || !dbUrl" class="px-4 py-2.5 rounded-xl text-xs font-medium border transition-all disabled:opacity-40" :style="{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }">
              {{ testingDb ? '测试中…' : '测试连接' }}
            </button>
          </div>
          <div v-if="dbTestResult" class="mt-1.5 text-xs font-medium" :class="dbTestResult.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'">
            {{ dbTestResult.ok ? '✓ 连接成功' : `✗ ${dbTestResult.error}` }}
          </div>
        </div>
        <div>
          <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">Redis URL</label>
          <div class="flex gap-2">
            <input v-model="redisUrl" type="text" class="flex-1 px-3 py-2.5 rounded-xl border text-sm font-mono transition-colors focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }" placeholder="redis://..." />
            <button @click="testRedis" :disabled="testingRedis || !redisUrl" class="px-4 py-2.5 rounded-xl text-xs font-medium border transition-all disabled:opacity-40" :style="{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }">
              {{ testingRedis ? '测试中…' : '测试连接' }}
            </button>
          </div>
          <div v-if="redisTestResult" class="mt-1.5 text-xs font-medium" :class="redisTestResult.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'">
            {{ redisTestResult.ok ? '✓ 连接成功' : `✗ ${redisTestResult.error}` }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
