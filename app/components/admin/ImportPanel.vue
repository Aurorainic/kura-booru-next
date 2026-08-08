<script setup lang="ts">
// v0.10.0: 批量导入面板 — admin 管理后台 tab，不依赖 Telegram Bot。
// SSE 流式进度：每 URL 完成/失败/重复/过大均实时推送。
// 下载代理：后台「集成 → 下载代理」设置即可，无需 Bot。

defineOptions({ name: 'ImportPanel' })

const IMPORT_ICON = 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5'

const urls = ref('')
const importing = ref(false)
const progress = ref<{ task_id: string; url: string; status: string; detail: string }[]>([])
const summary = ref<{ total: number; succeeded: number; failed: number; too_large: number; timed_out: number } | null>(null)
let eventSource: EventSource | null = null

onUnmounted(() => eventSource?.close())

async function startImport() {
  const urlList = urls.value.split('\n').map(u => u.trim()).filter(Boolean)
  if (!urlList.length) return

  const toast = useToast()
  const urlMap: Record<string, string> = {}

  importing.value = true
  summary.value = null
  progress.value = urlList.map(url => ({ task_id: '', url, status: 'queued', detail: '排队中…' }))

  try {
    const resp = await fetchApi<{ results: { task_id: string; status: string; url?: string; error?: string }[] }>('/tasks/web-import', undefined, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: urlList }),
    })

    const taskIds: string[] = []
    resp.results.forEach((r, i) => {
      const url = r.url || urlList[i] || ''
      if (r.task_id) {
        urlMap[r.task_id] = url
        taskIds.push(r.task_id)
        progress.value[i] = { task_id: r.task_id, url, status: 'queued', detail: '已入队' }
      } else {
        progress.value[i] = { task_id: '', url, status: 'error', detail: r.error || '入队失败' }
      }
    })

    if (!taskIds.length) {
      importing.value = false
      toast.error('所有 URL 入队失败')
      return
    }

    eventSource = new EventSource(`/api/tasks/web-import/stream?task_ids=${taskIds.join(',')}`)

    eventSource.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        const idx = progress.value.findIndex(p => p.task_id === data.task_id)
        if (idx >= 0) {
          progress.value[idx] = {
            task_id: data.task_id,
            url: urlMap[data.task_id] || (progress.value[idx]?.url ?? ''),
            status: data.status,
            detail: data.detail,
          }
        }
      } catch { /* malformed SSE frame — skip */ }
    })

    eventSource.addEventListener('done', (e) => {
      try {
        summary.value = JSON.parse((e as MessageEvent).data)
      } catch {
        toast.error('导入结果解析失败')
      }
      importing.value = false
      eventSource?.close()
    })

    eventSource.addEventListener('error', () => {
      eventSource?.close()
      if (importing.value) {
        importing.value = false
        toast.error('进度流中断，请刷新页面查看导入结果')
      }
    })
  } catch {
    importing.value = false
    toast.error('导入请求失败')
  }
}

const statusIcon: Record<string, string> = {
  success: '✅',
  duplicate: '♻️',
  failed: '❌',
  too_large: '⚠️',
  queued: '⏳',
}
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <PageHeader title="批量导入" subtitle="粘贴图片链接，每行一个。不依赖 Telegram Bot — 配置「集成 → 下载代理」即可直连下载。" :icon="IMPORT_ICON" />

    <div class="dash-card !p-5 space-y-4">
      <div>
        <label class="text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">图片链接（每行一个）</label>
        <textarea v-model="urls" rows="8" placeholder="https://www.pixiv.net/artworks/12345&#10;https://twitter.com/user/status/67890"
          class="w-full px-3 py-2.5 rounded-xl border text-sm font-mono transition-colors focus:outline-none focus:border-[var(--accent-color)]"
          :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }"
          :disabled="importing" />
      </div>

      <div class="flex justify-end">
        <button @click="startImport" :disabled="importing || !urls.trim()"
          class="btn-primary !px-5 !py-2.5 !text-sm">
          {{ importing ? '导入中…' : '开始导入' }}
        </button>
      </div>

      <!-- Real-time progress list -->
      <div v-if="progress.length > 0" class="space-y-1.5">
        <div v-for="(item, i) in progress" :key="i"
          class="flex items-center gap-2.5 text-sm rounded-lg px-3 py-2"
          :style="{ background: 'var(--bg-alt)', border: '1px solid var(--border-color)' }">
          <span class="text-base flex-shrink-0">{{ statusIcon[item.status] || '⏳' }}</span>
          <span class="font-mono text-xs text-[var(--text-muted)] flex-shrink-0 min-w-0 truncate max-w-[200px]">{{ item.url }}</span>
          <span class="text-[var(--text-muted)] text-xs flex-1 min-w-0 truncate">{{ item.detail }}</span>
        </div>
      </div>

      <!-- Empty state before first import -->
      <div v-else-if="!summary" class="flex items-center justify-center text-xs text-[var(--text-muted)] rounded-lg px-4 py-6 border border-dashed"
        :style="{ borderColor: 'var(--border-color)', background: 'var(--bg-alt)' }">
        导入记录将显示在这里
      </div>

      <!-- Summary -->
      <div v-if="summary" class="flex flex-wrap items-center gap-4 text-sm rounded-lg px-4 py-3"
        :style="{ background: 'var(--bg-alt)', border: '1px solid var(--border-color)' }">
        <span class="font-semibold">导入完成</span>
        <span class="text-[var(--color-success)]">✅ {{ summary.succeeded }} 成功</span>
        <span v-if="summary.too_large" class="text-[var(--color-warning, #b45309)]">⚠️ {{ summary.too_large }} 过大</span>
        <span v-if="summary.failed" class="text-[var(--color-danger)]">❌ {{ summary.failed }} 失败</span>
        <span v-if="summary.timed_out" class="text-[var(--text-muted)]">⏰ {{ summary.timed_out }} 超时</span>
      </div>

      <p class="text-[0.6875rem] text-[var(--text-muted)] leading-relaxed">
        支持 Pixiv、Twitter/X、Danbooru 等来源。下载代理可在「设置 → 集成」卡片配置（HTTP/SOCKS5），
        无需配置 Telegram Bot 即可使用。每个 URL 限制最多 5 张图片。
      </p>
    </div>
  </div>
</template>
