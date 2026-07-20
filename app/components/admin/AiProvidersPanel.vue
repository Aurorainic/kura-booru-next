<script setup lang="ts">
import type { AiProvider } from '~/types'

const { ssrCookie } = useSsrContext()
const toast = useToast()
const confirm = useConfirm()

const { data, refresh } = await useAsyncData('ai-providers', async () => {
  try { return await fetchAiProviders(ssrCookie.value) }
  catch { return { tag_processing: false, providers: [] as AiProvider[] } }
})

const providers = computed(() => data.value?.providers || [])
const tagProcessing = ref(data.value?.tag_processing ?? false)
watch(data, (val) => { if (val) tagProcessing.value = val.tag_processing })

// ── Global toggle ──
const toggling = ref(false)
async function toggleTagProcessing() {
  const next = !tagProcessing.value
  toggling.value = true
  try {
    const res = await setAiTagProcessing(next)
    tagProcessing.value = res.tag_processing
    toast.success(next ? 'AI 标签处理已开启' : 'AI 标签处理已关闭')
  } catch (e: any) {
    toast.error(`切换失败: ${e.message || e}`)
  } finally {
    toggling.value = false
  }
}

// ── Add / edit form ──
const editingId = ref<string | null>(null) // null = creating new
const formOpen = ref(false)
const form = reactive({ name: '', endpoint: '', model: '', apiKey: '', enabled: false })
const saving = ref(false)

function openCreate() {
  editingId.value = null
  form.name = ''
  form.endpoint = ''
  form.model = ''
  form.apiKey = ''
  form.enabled = providers.value.length === 0
  formTestResult.value = null
  formOpen.value = true
}

function openEdit(p: AiProvider) {
  editingId.value = p.id
  form.name = p.name
  form.endpoint = p.endpoint
  form.model = p.model
  form.apiKey = '' // empty = keep existing
  form.enabled = p.enabled
  formTestResult.value = null
  formOpen.value = true
}

function cancelForm() {
  formOpen.value = false
  editingId.value = null
}

async function saveProvider() {
  if (!form.name.trim() || !form.endpoint.trim() || !form.model.trim()) {
    toast.error('请填写名称、Endpoint 与模型')
    return
  }
  saving.value = true
  try {
    if (editingId.value) {
      await updateAiProvider(editingId.value, {
        name: form.name.trim(),
        endpoint: form.endpoint.trim(),
        model: form.model.trim(),
        apiKey: form.apiKey, // empty string → server keeps existing key
        enabled: form.enabled,
      })
      toast.success('Provider 已更新')
    } else {
      if (!form.apiKey.trim()) {
        toast.error('请填写 API Key')
        return
      }
      await createAiProvider({
        name: form.name.trim(),
        endpoint: form.endpoint.trim(),
        model: form.model.trim(),
        apiKey: form.apiKey.trim(),
        enabled: form.enabled,
      })
      toast.success('Provider 已创建')
    }
    cancelForm()
    await refresh()
  } catch (e: any) {
    toast.error(`保存失败: ${e.message || e}`)
  } finally {
    saving.value = false
  }
}

// ── Enable / disable / delete ──
async function setEnabled(p: AiProvider, enabled: boolean) {
  try {
    await updateAiProvider(p.id, { enabled })
    await refresh()
    toast.success(enabled ? `已启用 "${p.name}"（其他 Provider 已自动停用）` : `已停用 "${p.name}"`)
  } catch (e: any) {
    toast.error(`操作失败: ${e.message || e}`)
  }
}

async function removeProvider(p: AiProvider) {
  if (!await confirm.ask({
    message: `确定删除 "${p.name}"？此操作不可恢复。`,
    title: '删除 Provider',
    danger: true,
    confirmLabel: '删除',
  })) return
  try {
    await deleteAiProvider(p.id)
    await refresh()
    toast.success('Provider 已删除')
  } catch (e: any) {
    toast.error(`删除失败: ${e.message || e}`)
  }
}

// ── Connection test ──
const testingId = ref<string | null>(null) // provider id, or 'form'
const testResults = reactive<Record<string, { ok: boolean; latencyMs: number; error?: string }>>({})
const formTestResult = ref<{ ok: boolean; latencyMs: number; error?: string } | null>(null)

async function testProvider(p: AiProvider) {
  testingId.value = p.id
  try {
    testResults[p.id] = await testAiProviderConnection({ id: p.id })
  } catch (e: any) {
    testResults[p.id] = { ok: false, latencyMs: 0, error: e.message || '测试失败' }
  } finally {
    testingId.value = null
  }
}

async function testFormPayload() {
  if (!form.endpoint.trim() || !form.model.trim()) {
    toast.error('请先填写 Endpoint 与模型')
    return
  }
  testingId.value = 'form'
  formTestResult.value = null
  try {
    formTestResult.value = await testAiProviderConnection({
      id: editingId.value || undefined, // editing: server falls back to stored key
      endpoint: form.endpoint.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim() || undefined,
    })
  } catch (e: any) {
    formTestResult.value = { ok: false, latencyMs: 0, error: e.message || '测试失败' }
  } finally {
    testingId.value = null
  }
}

function formatDate(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <PageHeader title="AI 设置" subtitle="管理 AI Provider 与全局开关，变更即时生效，无需重启。" />

    <!-- Global toggle -->
    <div class="dash-card !p-5">
      <label class="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          class="w-4 h-4 rounded accent-[var(--accent-color)]"
          :checked="tagProcessing"
          :disabled="toggling"
          @change="toggleTagProcessing"
        />
        <span class="text-sm font-medium text-[var(--text-primary)]">启用 AI 标签处理</span>
        <span class="text-xs text-[var(--text-muted)]">全局开关 — 关闭后所有 AI 功能（分类 / 合并 / 评级 / 对话）立即停用</span>
      </label>
      <p v-if="tagProcessing && !providers.some(p => p.enabled)" class="text-xs text-[var(--color-warning)] mt-2">
        ⚠️ 全局开关已开启，但还没有已启用的 Provider — 请在下方启用一个。
      </p>
    </div>

    <!-- Provider list -->
    <div class="dash-card !p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold" style="font-family: var(--font-display);">Providers ({{ providers.length }})</h2>
        <button v-if="!formOpen" type="button" class="btn-primary !text-xs !px-3 !py-1.5" @click="openCreate">+ 添加 Provider</button>
      </div>

      <EmptyState
        v-if="providers.length === 0 && !formOpen"
        title="还没有配置任何 AI Provider"
        description="添加一个 OpenAI 兼容的 Provider 即可启用 AI 功能"
        icon="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
      />

      <div v-else class="space-y-2">
        <div
          v-for="p in providers"
          :key="p.id"
          class="px-3 py-2.5 rounded-[var(--radius-sm)] border transition-colors"
          :class="p.enabled ? 'border-[var(--accent-color)] bg-[var(--accent-subtle)]' : 'border-[var(--border-color)] hover:border-[var(--accent-color)]'"
        >
          <div class="flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-sm">{{ p.name }}</span>
                <span v-if="p.enabled" class="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">已启用</span>
                <span v-else class="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-[var(--bg-primary)] text-[var(--text-muted)]">已停用</span>
              </div>
              <div class="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-3 flex-wrap">
                <code class="font-mono break-all">{{ p.endpoint }}</code>
                <span>模型: <code class="font-mono">{{ p.model }}</code></span>
                <span>Key: <code class="font-mono">{{ p.api_key_masked }}</code></span>
              </div>
              <div v-if="testResults[p.id]" class="mt-1.5 text-xs font-medium" :class="testResults[p.id]!.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'">
                {{ testResults[p.id]!.ok ? `✓ 连接成功 (${testResults[p.id]!.latencyMs}ms)` : `✗ ${testResults[p.id]!.error}` }}
              </div>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                class="btn-ghost !text-xs !px-2.5 !py-1.5 !border !border-[var(--border-color)] !rounded-[var(--radius-sm)] disabled:opacity-40"
                :disabled="testingId === p.id"
                @click="testProvider(p)"
              >{{ testingId === p.id ? '测试中…' : '测试连接' }}</button>
              <button
                type="button"
                class="btn-ghost !text-xs !px-2.5 !py-1.5 !border !border-[var(--border-color)] !rounded-[var(--radius-sm)]"
                @click="openEdit(p)"
              >编辑</button>
              <button
                v-if="!p.enabled"
                type="button"
                class="btn-primary !text-xs !px-2.5 !py-1.5"
                @click="setEnabled(p, true)"
              >启用</button>
              <button
                v-else
                type="button"
                class="btn-ghost !text-xs !px-2.5 !py-1.5 !border !border-[var(--border-color)] !rounded-[var(--radius-sm)]"
                @click="setEnabled(p, false)"
              >停用</button>
              <button
                type="button"
                class="btn-danger !text-xs !px-2.5 !py-1.5"
                @click="removeProvider(p)"
              >删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add / edit form -->
    <div v-if="formOpen" class="dash-card !p-5 border-2 border-[var(--accent-color)] space-y-4">
      <h2 class="text-sm font-semibold" style="font-family: var(--font-display);">
        {{ editingId ? '编辑 Provider' : '添加 Provider' }}
      </h2>
      <div>
        <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">名称</label>
        <input v-model="form.name" type="text" maxlength="64" placeholder="如: DeepSeek 生产" class="w-full px-3 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }" />
      </div>
      <div>
        <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">Endpoint</label>
        <input v-model="form.endpoint" type="text" placeholder="https://api.example.com/v1" class="w-full px-3 py-2.5 rounded-xl border text-sm font-mono transition-colors focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }" />
        <p class="text-[0.625rem] text-[var(--text-muted)] mt-1">OpenAI 兼容 API 的基础地址（不含 /chat/completions）。</p>
      </div>
      <div>
        <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">模型</label>
        <input v-model="form.model" type="text" maxlength="128" placeholder="如: deepseek-chat / gpt-4o-mini" class="w-full px-3 py-2.5 rounded-xl border text-sm font-mono transition-colors focus:outline-none focus:border-[var(--accent-color)]" :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }" />
      </div>
      <div>
        <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">API Key</label>
        <input
          v-model="form.apiKey"
          type="password"
          autocomplete="new-password"
          :placeholder="editingId ? '保持不变' : 'sk-...'"
          class="w-full px-3 py-2.5 rounded-xl border text-sm font-mono transition-colors focus:outline-none focus:border-[var(--accent-color)]"
          :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }"
        />
        <p class="text-[0.625rem] text-[var(--text-muted)] mt-1">
          {{ editingId ? '留空表示保持现有 Key 不变。Key 仅存储在服务端，任何接口都不会返回明文。' : 'Key 仅存储在服务端，任何接口都不会返回明文。' }}
        </p>
      </div>
      <label class="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer select-none">
        <input v-model="form.enabled" type="checkbox" class="w-3.5 h-3.5 accent-[var(--accent-color)]" />
        <span>启用此 Provider（启用后自动停用其他 Provider，同时最多一个生效）</span>
      </label>
      <div v-if="formTestResult" class="text-xs font-medium" :class="formTestResult.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'">
        {{ formTestResult.ok ? `✓ 连接成功 (${formTestResult.latencyMs}ms)` : `✗ ${formTestResult.error}` }}
      </div>
      <div class="flex items-center gap-2 pt-1">
        <button type="button" class="btn-primary !px-5 !py-2.5 !text-sm" :disabled="saving" @click="saveProvider">
          {{ saving ? '保存中…' : (editingId ? '保存更改' : '创建') }}
        </button>
        <button
          type="button"
          class="btn-ghost !text-sm !px-4 !py-2.5 !border !border-[var(--border-color)] !rounded-xl disabled:opacity-40"
          :disabled="testingId === 'form'"
          @click="testFormPayload"
        >{{ testingId === 'form' ? '测试中…' : '测试连接' }}</button>
        <button type="button" class="btn-ghost !text-sm !px-4 !py-2.5" @click="cancelForm">取消</button>
      </div>
    </div>

    <p class="text-xs text-[var(--text-muted)]">
      提示: .env 中的 <code>AI_PROVIDER_*</code> 变量现在仅用于首次启动时的自动导入（表为空时），日常配置请在此页面管理。
    </p>
  </div>
</template>
