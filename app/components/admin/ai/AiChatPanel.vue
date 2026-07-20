<script setup lang="ts">
import type { AssistantReply } from '~/types'

const props = defineProps<{
  ssrCookie: string
}>()

const toast = useToast()
const chatInput = ref('')

// ponytail: chat history persists across section switches AND page reloads
// via localStorage. Capped at 50 messages (25 Q&A pairs) to stay within
// localStorage size limits while preserving long conversations.
const STORAGE_KEY = 'kura-ai-chat-history'
const chatMessages = ref<{ role: 'user' | 'assistant'; content: string; suggestions?: any[] }[]>([])
const chatLoading = ref(false)

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) chatMessages.value = JSON.parse(raw).slice(-50)
  } catch { /* ignore - corrupted localStorage, start fresh */ }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chatMessages.value.slice(-50)))
  } catch { /* ignore - quota exceeded, keep in-memory only */ }
}

onMounted(loadHistory)

// Clear conversation - admin wants a fresh start
function clearChat() {
  chatMessages.value = []
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  toast.info('已清空对话')
}

function applySuggestion(s: any) {
  if (s?.callback_data) {
    chatInput.value = s.callback_data
    sendChat()
  }
}

// Quick-start prompts for empty state
function quickStart(prompt: string) {
  chatInput.value = prompt
  sendChat()
}

async function sendChat() {
  const q = chatInput.value.trim()
  if (!q || chatLoading.value) return

  chatMessages.value.push({ role: 'user', content: q })
  saveHistory()
  chatInput.value = ''
  chatLoading.value = true

  try {
    // ponytail: send the last 10 messages (5 Q&A pairs) as history so the
    // AI has real conversational context. Previously NO history was sent -
    // every message was a cold start, so follow-ups like "那翻译呢?" had
    // no referent and the AI answered as if it was a new session.
    // We slice(-11, -1) to exclude the message we just pushed (last item)
    // and take the 10 messages before it.
    const history = chatMessages.value
      .slice(-11, -1)
      .map(m => ({ role: m.role, content: m.content }))

    const reply: AssistantReply = await adminChat(
      { query: q, history, lang: 'zh' },
      props.ssrCookie,
    )
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
      <!-- Empty state with quick-start prompts -->
      <div v-if="!chatMessages.length" class="flex flex-col items-center justify-center h-48 text-[var(--text-muted)] text-xs gap-3">
        <p>向 AI 助手提问，例如：</p>
        <div class="flex flex-col gap-1.5 items-center">
          <button class="text-[var(--accent-color)] hover:underline" @click="quickStart('有多少未处理的标签？')">"有多少未处理的标签？"</button>
          <button class="text-[var(--accent-color)] hover:underline" @click="quickStart('safe 占比是多少？')">"safe 占比是多少？"</button>
          <button class="text-[var(--accent-color)] hover:underline" @click="quickStart('帮我分类未处理标签')">"帮我分类未处理标签"</button>
        </div>
      </div>
      <!-- Chat messages -->
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
      <!-- Loading indicator -->
      <div v-if="chatLoading" class="flex justify-start">
        <div class="rounded-xl px-3 py-2 text-sm text-[var(--text-muted)] border border-[var(--border-color)]">
          <span class="animate-pulse">思考中…</span>
        </div>
      </div>
    </div>
    <!-- Input bar -->
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
      <button
        v-if="chatMessages.length > 0"
        @click="clearChat"
        class="btn-ghost !text-xs !px-3 !py-2.5"
        title="清空对话"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>
  </div>
</template>
