<script setup lang="ts">
import type { TagCategory } from '~/types'

const { ssrCookie } = useSsrContext()

const urls = ref('')
const results = ref<{ task_id: string; status: string }[]>([])
const streamMessages = ref<{ task_id: string; status: string; detail: string }[]>([])
const importing = ref(false)
const done = ref(false)

async function startImport() {
  const urlList = urls.value.split('\n').map(u => u.trim()).filter(Boolean)
  if (!urlList.length) return

  importing.value = true
  done.value = false
  streamMessages.value = []
  results.value = []

  try {
    // Enqueue all URLs
    const resp = await $fetch<{ results: { task_id: string; status: string }[] }>('/api/tasks/web-import', {
      method: 'POST',
      credentials: 'include',
      body: { urls: urlList },
    })
    results.value = resp.results
    const taskIds = resp.results.map(r => r.task_id).filter(Boolean)

    if (!taskIds.length) return

    // SSE stream for progress
    const eventSource = new EventSource(`/api/tasks/web-import/stream?task_ids=${taskIds.join(',')}`)

    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data)
      streamMessages.value.push(data)
    })

    eventSource.addEventListener('done', (e) => {
      const data = JSON.parse(e.data)
      done.value = true
      importing.value = false
      eventSource.close()
    })

    eventSource.addEventListener('error', () => {
      eventSource.close()
      importing.value = false
    })
  } catch {
    importing.value = false
  }
}
</script>

<template>
  <div class="space-y-4 max-w-2xl">
    <h2 class="text-lg font-bold" style="font-family: var(--font-display);">批量导入</h2>

    <div class="card p-5 space-y-4">
      <div>
        <label class="text-sm font-medium block mb-1.5">图片链接（每行一个）</label>
        <textarea v-model="urls" rows="8" placeholder="https://www.pixiv.net/artworks/12345&#10;https://twitter.com/user/status/67890" class="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-surface)] text-sm font-mono" :disabled="importing" />
      </div>

      <button @click="startImport" :disabled="importing || !urls.trim()" class="px-5 py-2 rounded text-sm font-medium" style="background: var(--accent-color); color: var(--bg-primary);">
        {{ importing ? '导入中…' : '开始导入' }}
      </button>

      <!-- Progress -->
      <div v-if="streamMessages.length > 0" class="space-y-1">
        <div v-for="msg in streamMessages" :key="msg.task_id" class="flex items-center gap-2 text-sm">
          <span v-if="msg.status === 'success'">✅</span>
          <span v-else-if="msg.status === 'failed'">❌</span>
          <span v-else>⏳</span>
          <span class="font-mono text-xs">{{ msg.task_id?.slice(0, 8) }}…</span>
          <span class="text-[var(--text-muted)]">{{ msg.detail }}</span>
        </div>
      </div>

      <p v-if="done" class="text-sm text-[var(--color-success)]">✓ 导入完成</p>
    </div>
  </div>
</template>
