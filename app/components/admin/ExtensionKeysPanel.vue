<script setup lang="ts">
import type { ExtensionKey } from '~/composables/api'

const { ssrCookie } = useSsrContext()

const { data: keys, refresh } = await useAsyncData('extension-keys', async () => {
  try { return await fetchExtensionKeys(ssrCookie.value) }
  catch { return [] }
})

const newName = ref('')
const newCanForceRating = ref(false)
const justCreatedKey = ref<{ id: string; name: string; raw_key: string; canForceRating: boolean } | null>(null)
const copied = ref(false)

async function createKey() {
  const name = newName.value.trim()
  if (!name) return
  try {
    justCreatedKey.value = await createExtensionKey(name, newCanForceRating.value)
    newName.value = ''
    newCanForceRating.value = false
    await refresh()
  } catch (e: any) {
    alert(`创建失败: ${e.message || e}`)
  }
}

async function revokeKey(id: string, name: string) {
  if (!confirm(`确定吊销 "${name}"？该 key 立即失效。`)) return
  try {
    await revokeExtensionKey(id)
    await refresh()
  } catch (e: any) {
    alert(`吊销失败: ${e.message || e}`)
  }
}

async function copyRawKey() {
  if (!justCreatedKey.value) return
  try {
    await navigator.clipboard.writeText(justCreatedKey.value.raw_key)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    alert('复制失败,请手动选择文本')
  }
}

function formatDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="space-y-6">
    <!-- Create new key -->
    <div class="dash-card !p-5">
      <h2 class="text-sm font-semibold mb-3" style="font-family: var(--font-display);">生成新 Key</h2>
      <p class="text-xs text-[var(--text-muted)] mb-3">
        为浏览器扩展生成专用 API Key。每个 Key 独立可吊销,与 <code>BACKEND_API_KEY</code> 完全隔离。
      </p>
      <div class="flex items-center gap-2">
        <input
          v-model="newName"
          type="text"
          placeholder="Key 友好名 (如:我的 Chrome 笔记本)"
          maxlength="64"
          class="flex-1 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-color)]"
          @keyup.enter="createKey"
        />
        <button
          type="button"
          class="btn-primary !text-sm !px-4 !py-2"
          :disabled="!newName.trim()"
          @click="createKey"
        >生成</button>
      </div>
      <label class="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer select-none mt-1">
        <input v-model="newCanForceRating" type="checkbox" class="w-3.5 h-3.5 accent-[var(--accent-color)]" />
        <span>允许此 Key 在导入时覆盖内容评级 (force_rating)</span>
      </label>
    </div>

    <!-- Newly created key (one-time reveal) -->
    <div v-if="justCreatedKey" class="dash-card !p-5 border-2 border-[var(--accent-color)]">
      <h2 class="text-sm font-semibold mb-2 text-[var(--accent-color)]">⚠️ 复制此 Key — 只显示一次</h2>
      <p class="text-xs text-[var(--text-muted)] mb-3">
        Key 明文只在此页面显示一次。关闭后无法再查看,如丢失请吊销旧 Key 并生成新的。
      </p>
      <div class="flex items-center gap-2">
        <code class="flex-1 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm font-mono break-all select-all">{{ justCreatedKey.raw_key }}</code>
        <button
          type="button"
          class="btn-primary !text-sm !px-4 !py-2 whitespace-nowrap"
          @click="copyRawKey"
        >{{ copied ? '已复制 ✓' : '复制' }}</button>
      </div>
      <p class="text-xs text-[var(--text-muted)] mt-3">
        名称: <strong>{{ justCreatedKey.name }}</strong> · 把这个 Key 粘贴到浏览器扩展的 popup 即可。
      </p>
    </div>

    <!-- Existing keys list -->
    <div class="dash-card !p-5">
      <h2 class="text-sm font-semibold mb-3" style="font-family: var(--font-display);">已有 Key ({{ keys?.length || 0 }})</h2>
      <div v-if="!keys || keys.length === 0" class="text-xs text-[var(--text-muted)] py-8 text-center">
        还没有任何 Key
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="key in keys"
          :key="key.id"
          class="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-sm)] border border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors"
          :class="{ 'opacity-50': !key.active }"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm">{{ key.name }}</span>
              <span v-if="!key.active" class="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">已吊销</span>
              <span v-else class="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">活跃</span>
              <span v-if="key.canForceRating" class="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400" title="此 Key 允许 force_rating 覆盖">force_rating</span>
            </div>
            <div class="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-3 flex-wrap">
              <code class="font-mono">{{ key.keyPrefix }}…</code>
              <span>创建: {{ key.createdBy }} · {{ formatDate(key.createdAt) }}</span>
              <span v-if="key.lastUsedAt">最近使用: {{ formatDate(key.lastUsedAt) }}</span>
            </div>
          </div>
          <button
            v-if="key.active"
            type="button"
            class="btn-danger !text-xs !px-3 !py-1.5"
            @click="revokeKey(key.id, key.name)"
          >吊销</button>
        </div>
      </div>
    </div>
  </div>
</template>