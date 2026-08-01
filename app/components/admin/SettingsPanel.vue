<script setup lang="ts">
// v0.10.0: 全站设置后台 — 7 类卡片（site/images/storage/bot/integrations/infra/admin）。
// 数据来自 GET /api/admin/settings（含 metadata：type/label/description/secret/masked），
// secret 项掩码显示、空输入=保持原值；保存走 PUT /api/admin/settings（服务端热刷新）。
import type { SettingItem } from '~/composables/api'
const { ssrCookie } = useSsrContext()
const toast = useToast()

const saving = ref(false)
const saved = ref(false)

const { data } = await useAsyncData('admin-settings', async () => {
  try {
    return await fetchAdminSettings(ssrCookie.value)
  } catch {
    return null
  }
})
const categories = computed(() => data.value?.categories || [])
const items = computed(() => data.value?.items || [])

// 可编辑草稿：key -> value（secret 项空串 = 保持原值）
const draft = reactive<Record<string, string>>({})
const secretDirty = reactive<Record<string, boolean>>({})
// 测试按钮状态
const testStates = reactive<Record<string, { testing: boolean; result: { ok?: boolean; error?: string; username?: string; id?: number; bucket?: string; region?: string; endpoint?: string } | null }>>({})

function itemsOf(cat: string): SettingItem[] {
  return items.value.filter(i => i.category === cat)
}

watch(items, (list) => {
  for (const it of list) {
    if (it.secret) {
      draft[it.key] = ''
      secretDirty[it.key] = false
    } else {
      draft[it.key] = it.value
    }
    if (!testStates[it.key]) testStates[it.key] = { testing: false, result: null }
  }
}, { immediate: true })

function setSecret(key: string, val: string) {
  draft[key] = val
  secretDirty[key] = val !== ''
}

async function save() {
  saving.value = true
  saved.value = false
  const payload: Record<string, string> = {}
  for (const it of items.value) {
    if (it.secret) {
      if (secretDirty[it.key]) payload[it.key] = draft[it.key] || ''
    } else {
      payload[it.key] = draft[it.key] || ''
    }
  }
  try {
    await updateAdminSettings(payload)
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
    // 重新拉取（获得新的 masked 值）
    await refreshNuxtData('admin-settings')
  } catch {
    toast.error('保存失败')
  } finally {
    saving.value = false
  }
}

// ── 连接测试 ──
function testState(key: string) {
  if (!testStates[key]) testStates[key] = { testing: false, result: null }
  return testStates[key]
}

async function runTest(key: string, fn: () => Promise<any>) {
  const st = testState(key)
  st.testing = true
  st.result = null
  try {
    st.result = await fn()
  } catch (e: any) {
    st.result = { ok: false, error: e?.message || '测试失败' }
  } finally {
    st.testing = false
  }
}

function testPg() {
  runTest('database_url', () => testPgConnection(draft.database_url || ''))
}
function testRedis() {
  runTest('redis_url', () => testRedisConnection(draft.redis_url || ''))
}
function testS3() {
  runTest('s3_test', () => testS3Connection())
}
function testBot() {
  runTest('bot_test', () => testBotConnection({
    token: draft.bot_token || undefined,
    proxyType: draft.bot_proxy_type || undefined,
    proxyUrl: draft.bot_proxy_url || undefined,
  }))
}

// ── 渲染辅助 ──
function fieldClasses() {
  return 'w-full px-3 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:border-[var(--accent-color)]'
}
function fieldStyle() {
  return { borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }
}
function testResultText(r: { ok?: boolean; error?: string } | null): string {
  if (!r) return ''
  return r.ok ? '✓ 连接成功' : `✗ ${r.error || '连接失败'}`
}
/** 自适应布局：textarea/长字段跨整行；其余字段在 sm+ 双列排列。 */
function fieldSpan(item: SettingItem): string {
  return item.type === 'textarea' ? 'sm:col-span-2' : ''
}
</script>

<template>
  <div class="max-w-6xl">
    <div class="flex items-center justify-between flex-wrap gap-3 mb-6">
      <PageHeader title="站点设置" subtitle="全站配置均已迁移到数据库，保存后立即热刷新生效。" />
      <div class="flex items-center gap-3">
        <button @click="save" :disabled="saving" class="btn-primary !px-5 !py-2.5 !text-sm">
          {{ saving ? '保存中…' : '保存所有更改' }}
        </button>
        <Transition name="fade">
          <span v-if="saved" class="text-sm font-medium text-[var(--color-success)]">✓ 已保存</span>
        </Transition>
      </div>
    </div>

    <!-- 自适应瀑布流：窄屏单列，xl+ 双列（CSS columns 自动均衡高度，避免同行等高空隙） -->
    <div class="columns-1 xl:columns-2 gap-6">
      <template v-for="cat in categories" :key="cat.key">
        <!-- 管理员类卡片：只读说明，密码走独立面板 -->
        <div v-if="cat.key === 'admin'" class="dash-card !p-5 break-inside-avoid mb-6">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-semibold text-[var(--text-primary)]">{{ cat.label }}</h3>
              <p class="text-xs text-[var(--text-muted)] mt-0.5">{{ cat.description }}</p>
            </div>
            <NuxtLink to="/admin?tab=password" class="btn-ghost !text-xs !px-4 !py-2 !border !border-[var(--border-color)] !rounded-xl whitespace-nowrap flex-shrink-0">修改密码</NuxtLink>
          </div>
        </div>

        <!-- 其余卡片 -->
        <div v-else class="dash-card !p-5 break-inside-avoid mb-6">
          <div class="mb-4">
            <h3 class="text-sm font-semibold text-[var(--text-primary)]">{{ cat.label }}</h3>
            <p class="text-xs text-[var(--text-muted)] mt-0.5">{{ cat.description }}</p>
          </div>

          <!-- 字段自适应：窄屏单列，sm+ 双列（textarea 跨整行） -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
            <div v-for="item in itemsOf(cat.key)" :key="item.key" :class="fieldSpan(item)">
              <!-- readonly：仅展示 -->
              <template v-if="item.type === 'readonly'">
                <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">{{ item.label }}</label>
                <div class="flex gap-2">
                  <input :value="draft[item.key] ?? ''" type="text" readonly
                    class="flex-1 min-w-0 px-3 py-2.5 rounded-xl border text-sm font-mono opacity-70 cursor-not-allowed"
                    :style="fieldStyle()" :placeholder="item.note" />
                  <button
                    v-if="item.key === 'database_url'"
                    @click="testPg" :disabled="testState('database_url').testing || !draft.database_url"
                    class="btn-ghost !text-xs !px-4 !py-2.5 !border !border-[var(--border-color)] !rounded-xl disabled:opacity-40 whitespace-nowrap flex-shrink-0">
                    {{ testState('database_url').testing ? '测试中…' : '测试连接' }}
                  </button>
                  <button
                    v-else-if="item.key === 'redis_url'"
                    @click="testRedis" :disabled="testState('redis_url').testing || !draft.redis_url"
                    class="btn-ghost !text-xs !px-4 !py-2.5 !border !border-[var(--border-color)] !rounded-xl disabled:opacity-40 whitespace-nowrap flex-shrink-0">
                    {{ testState('redis_url').testing ? '测试中…' : '测试连接' }}
                  </button>
                </div>
                <p class="text-[0.625rem] text-[var(--text-muted)] mt-1">{{ item.note }}</p>
                <div v-if="testState(item.key).result" class="mt-1.5 text-xs font-medium"
                  :class="testState(item.key).result!.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'">
                  {{ testResultText(testState(item.key).result) }}
                </div>
              </template>

              <!-- boolean -->
              <label v-else-if="item.type === 'boolean'" class="flex items-center gap-3 py-1 cursor-pointer">
                <input type="checkbox" class="w-4 h-4 rounded accent-[var(--accent-color)]"
                  :checked="draft[item.key] === 'true'"
                  @change="draft[item.key] = ($event.target as HTMLInputElement).checked ? 'true' : 'false'" />
                <span class="text-sm text-[var(--text-primary)]">{{ item.label }}</span>
                <span v-if="item.description" class="text-xs text-[var(--text-muted)]">{{ item.description }}</span>
              </label>

              <!-- secret：掩码 + 留空保持原值 -->
              <template v-else-if="item.type === 'secret'">
                <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">{{ item.label }}</label>
                <input
                  :type="secretDirty[item.key] ? 'password' : 'text'"
                  :value="secretDirty[item.key] ? draft[item.key] : item.masked"
                  :placeholder="item.masked ? '（已配置，输入以修改）' : '未配置'"
                  :class="fieldClasses() + ' font-mono'"
                  :style="fieldStyle()"
                  @input="setSecret(item.key, ($event.target as HTMLInputElement).value)"
                  @focus="setSecret(item.key, '')"
                />
                <p class="text-[0.625rem] text-[var(--text-muted)] mt-1">{{ item.description }} 留空保持原值，保存后不回显明文。</p>
              </template>

              <!-- select：下拉选项（如 bot_proxy_type / run_mode） -->
              <template v-else-if="item.type === 'select'">
                <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">{{ item.label }}</label>
                <select v-model="draft[item.key]" :class="fieldClasses() + ' cursor-pointer'"
                  :style="{ ...fieldStyle(), appearance: 'auto' }">
                  <option v-for="opt in item.options || []" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
                <p class="text-[0.625rem] text-[var(--text-muted)] mt-1">{{ item.description }}</p>
                <div v-if="item.key === 'run_mode'" class="mt-2 text-[0.625rem] leading-relaxed rounded-lg px-3 py-2"
                  :style="draft.run_mode === 'public'
                    ? { color: 'var(--color-danger)', background: 'var(--color-danger)/8', border: '1px solid var(--color-danger)/25' }
                    : { color: 'var(--color-warning, #b45309)', background: 'rgba(180,83,9,0.08)', border: '1px solid rgba(180,83,9,0.25)' }">
                  ⚠️ 切换即时生效。内网模式：任何人可访问管理后台、查看全部评级，切勿暴露公网；
                  公网模式：恢复登录墙与评级限制（匿名仅见 safe）。
                </div>
              </template>

              <!-- textarea -->
              <template v-else-if="item.type === 'textarea'">
                <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">{{ item.label }}</label>
                <textarea v-model="draft[item.key]" rows="3" :class="fieldClasses() + ' resize-none'"
                  :style="{ ...fieldStyle(), fontFamily: item.key === 'head_inject' ? 'var(--font-mono)' : undefined }"></textarea>
                <p class="text-[0.625rem] text-[var(--text-muted)] mt-1">{{ item.description }}</p>
              </template>

              <!-- number -->
              <template v-else-if="item.type === 'number'">
                <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">{{ item.label }}</label>
                <input v-model="draft[item.key]" type="number" :placeholder="item.placeholder"
                  :class="fieldClasses() + ' font-mono'" :style="fieldStyle()" />
                <p class="text-[0.625rem] text-[var(--text-muted)] mt-1">{{ item.description }}</p>
              </template>

              <!-- text -->
              <template v-else>
                <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">{{ item.label }}</label>
                <input v-model="draft[item.key]" type="text" :placeholder="item.placeholder"
                  :class="fieldClasses() + (item.key.startsWith('s3_') || item.key === 'site_url' || item.key === 'bot_proxy_url' ? ' font-mono' : '')"
                  :style="fieldStyle()" />
                <p class="text-[0.625rem] text-[var(--text-muted)] mt-1">{{ item.description }}</p>
              </template>
            </div>
          </div>

          <!-- 卡片级测试按钮（存储 / 机器人） -->
          <div v-if="cat.key === 'storage'" class="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-[var(--border-color)]">
            <button @click="testS3" :disabled="testState('s3_test').testing"
              class="btn-ghost !text-xs !px-4 !py-2 !border !border-[var(--border-color)] !rounded-xl disabled:opacity-40">
              {{ testState('s3_test').testing ? '测试中…' : '测试 S3 连接' }}
            </button>
            <span v-if="testState('s3_test').result" class="text-xs font-medium"
              :class="testState('s3_test').result!.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'">
              {{ testResultText(testState('s3_test').result) }}
              <span v-if="testState('s3_test').result!.ok && testState('s3_test').result!.bucket" class="text-[var(--text-muted)]">
                — {{ testState('s3_test').result!.bucket }}
              </span>
            </span>
          </div>
          <div v-if="cat.key === 'bot'" class="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-[var(--border-color)]">
            <button @click="testBot" :disabled="testState('bot_test').testing || !(draft.bot_token || '')"
              class="btn-ghost !text-xs !px-4 !py-2 !border !border-[var(--border-color)] !rounded-xl disabled:opacity-40">
              {{ testState('bot_test').testing ? '测试中…' : '测试 Bot 连接 (getMe)' }}
            </button>
            <span v-if="testState('bot_test').result" class="text-xs font-medium"
              :class="testState('bot_test').result!.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'">
              {{ testState('bot_test').result!.ok
                ? `✓ 连接成功 — @${testState('bot_test').result!.username}`
                : `✗ ${testState('bot_test').result!.error}` }}
            </span>
          </div>
        </div>
      </template>
    </div>

    <p class="text-[0.6875rem] text-[var(--text-muted)] mt-6">
      提示：数据库与 Redis 连接由环境变量提供（仅展示与测试）；机器人、存储、集成类配置保存在数据库中，
      修改后立即生效（S3 客户端与 Bot 实例自动重建）。Telegram Bot 中转支持三种方式：HTTP(S) 代理、
      SOCKS5 代理、MTProto 反代（apiRoot）——先选「中转类型」再填地址，可用「测试 Bot 连接」验证。
    </p>
  </div>
</template>
