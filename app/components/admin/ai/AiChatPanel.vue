<script setup lang="ts">
import type { AssistantReply } from '~/types'

const props = defineProps<{
  ssrCookie: string
}>()

const toast = useToast()
const chatInput = ref('')

// ponytail: chat history persists across section switches via localStorage,
// surviving page reloads. Without this, every visit to the chat section felt
// like a fresh start and broke conversational continuity.
const STORAGE_KEY = 'kura-ai-chat-history'
const chatMessages = ref<{ role: 'user' | 'assistant'; content: string; suggestions?: any[] }[]>([])
const chatLoading = ref(false)

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) chatMessages.value = JSON.parse(raw).slice(-50)  // cap at 50 msgs
  } catch { /* ignore */ }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chatMessages.value.slice(-50)))
  } catch { /* ignore */ }
}

onMounted(loadHistory)

function applySuggestion(s: any) {
  // ponytail: previously the suggestion buttons had no @click handler — they
  // were dead UI. Now clicking fills the input with the suggestion's callback
  // data and sends it.
  if (s?.callback_data) {
    chatInput.value = s.callback_data
    sendChat()
  }
}

async function sendChat() {
  const q = chatInput.value.trim()
  if (!q || chatLoading.value) return

  chatMessages.value.push({ role: 'user', content: q })
  saveHistory()
  chatInput.value = ''
  chatLoading.value = true

  try {
    const reply: AssistantReply = await adminChat({ query: q, lang: 'zh' }, props.ssrCookie)
    chatMessages.value.push({ role: 'assistant', content: reply.text, suggestions: reply.suggestions })
    saveHistory()
  } catch (e: any) {
    chatMessages.value.push({ role: 'assistant', content: `错误: ${e.message || '未知错误'}` })
    saveHistory()
  } finally {
    chatLoading.value = false
  }
}

// Auto-scroll chat container to bottom on new message
const chatScroll = ref<HTMLElement | null>(null)
watch(() => chatMessages.value.length, async () => {
  await nextTick()
  if (chatScroll.value) chatScroll.value.scrollTop = chatScroll.value.scrollHeight
})
</script>

<template>
  <div class="space-y-3">
    <div ref="chatScroll" class="dash-card !p-4 min-h-[300px] max-h-[500px] overflow-y-auto space-y-3">
      <div v-if="!chatMessages.length" class="flex items-center justify-center h-48 text-[var(--text-muted)] text-xs">
        向 AI 助手提问，例如："哪些标签缺少翻译？"
      </div>
      <div v-for="(msg, idx) in chatMessages" :key="idx" class="flex" :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
        <div
          class="max-w-[80%] rounded-xl px-3 py-2 text-sm"
          :class="msg.role === 'user' ? 'text-white' : 'text-[var(--text-primary)] border border-[var(--border-color)]'"
          :style="msg.role === 'user' ? { background: 'var(--accent-color)' } : { background: 'var(--bg-surface)' }"
        >
          <p class="whitespace-pre-wrap">{{ msg.content }}</p>
          <div v-if="msg.suggestions?.length" class="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-[var(--border-color)]/30">
            <button
              v-for="(s, si) in msg.suggestions"
              :key="si"
              class="px-2 py-1 text-[0.5625rem] rounded-md border border-[var(--accent-color)]/40 text-[var(--accent-color)] hover:bg-[var(--accent-subtle)] transition-colors"
              @click="applySuggestion(s)"
            >{{ s.label }}</button>
          </div>
        </div>
      </div>
      <div v-if="chatLoading" class="flex justify-start">
        <div class="rounded-xl px-3 py-2 text-sm text-[var(--text-muted)] border border-[var(--border-color)]">
          <span class="animate-pulse">思考中…</span>
        </div>
      </div>
    </div>
    <div class="flex gap-2">
      <input
        v-model="chatInput"
        type="text"
        placeholder="向 AI 助手提问…"
        class="flex-1 px-3 py-2.5 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-color)] transition-colors"
        @keydown.enter="sendChat"
      />
      <button @click="sendChat" :disabled="chatLoading || !chatInput.trim()" class="btn-primary !text-sm !px-4 !py-2.5">
        发送
      </button>
    </div>
  </div>
</template>
