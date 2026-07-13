/**
 * Bot rating flow: countdown timers, manual override, auto-confirm.
 * T-P0-3: Full rating flow with inline keyboard + 10s countdown.
 */

export const ratingCountdowns = new Map<string, NodeJS.Timeout>()

const RATING_LABELS: Record<string, Record<string, string>> = {
  zh: { safe: '公开', questionable: '敏感', explicit: '限制' },
  en: { safe: 'Safe', questionable: 'Questionable', explicit: 'Explicit' },
}
const RATING_EMOJI: Record<string, string> = { safe: '🟢', questionable: '🟡', explicit: '🔴' }

const L = {
  zh: { processingComplete: '处理完成', waitingRating: '等待评级', rating: '评级', autoRule: '自动规则', default: '默认', manual: '手动', auto: '自动' },
  en: { processingComplete: 'Processing complete', waitingRating: 'Waiting for rating', rating: 'Rating', autoRule: 'Auto-rating', default: 'default', manual: 'manual', auto: 'auto' },
}

function lb(key: string, lang: string): string {
  return (L as any)[lang]?.[key] || (L.en as any)[key] || key
}

export function startCountdown(
  api: any,
  chatId: string,
  messageId: number,
  postId: string,
  autoRating: string | undefined,
  lang: string,
  countdowns: Map<string, NodeJS.Timeout>,
) {
  let remaining = 10
  const autoNote = autoRating ? `\n${lb('autoRule', lang)}: ${autoRating}` : ''
  const waitText = lb('waitingRating', lang)

  const keyboard = {
    inline_keyboard: [[
      { text: '🟢 Safe', callback_data: `rate:${postId}:safe` },
      { text: '🟡 Questionable', callback_data: `rate:${postId}:questionable` },
      { text: '🔴 Explicit', callback_data: `rate:${postId}:explicit` },
    ]],
  }

  const timer = setInterval(async () => {
    remaining--
    if (remaining <= 0) {
      clearInterval(timer)
      countdowns.delete(postId)
      const rating = autoRating || 'safe'
      const label = autoRating ? `（${lb('autoRule', lang)}）` : `（${lb('default', lang)}）`
      await confirmRating(api, chatId, messageId, postId, rating, lang, label)
    } else {
      try {
        await api.editMessageText(
          chatId, messageId,
          `✅ ${lb('processingComplete', lang)}${autoNote}\n⏳ ${waitText} (${remaining}s)`,
          { reply_markup: keyboard },
        )
      } catch {
        // "message not modified" — ignore
      }
    }
  }, 1000)

  countdowns.set(postId, timer)
}

export async function confirmRating(
  api: any,
  chatId: string,
  messageId: number,
  postId: string,
  rating: string,
  lang: string,
  label: string,
) {
  const baseUrl = process.env.INTERNAL_API_URL || `http://localhost:${process.env.PORT || 3000}`
  const apiKey = process.env.BACKEND_API_KEY
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['x-api-key'] = apiKey

  // Write rating to DB first. On failure, surface a ⚠️ message — do NOT fall
  // through to the ✅ success text (would give a false confirmation). The old
  // code had a bare `redis.set` after this that threw TypeError (redis never
  // imported — Nitro auto-import rewrites other files' redis to `redis$1`, but
  // this module had no import so it stayed bare `undefined`), which aborted
  // confirmRating before the editMessageText that removes the inline keyboard.
  // INTERNAL_API_URL already includes /api (default http://127.0.0.1:3000/api,
  // see nuxt.config.ts runtimeConfig + logout.post.ts same convention).
  // Do NOT add another /api here — that produces /api/api/posts/:id → 404.
  try {
    const resp = await fetch(`${baseUrl}/posts/${postId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ rating }),
    })
    if (!resp.ok) {
      console.error(`[bot-rating] PATCH failed: ${resp.status} for post ${postId} rating=${rating}`)
      await api.editMessageText(
        chatId, messageId,
        `⚠️ ${lb('rating', lang)} ${rating} — DB update failed (${resp.status})`,
      ).catch(() => {})
      return
    }
  } catch (err) {
    console.error(`[bot-rating] PATCH error for post ${postId}:`, err)
    await api.editMessageText(
      chatId, messageId,
      `⚠️ ${lb('rating', lang)} ${rating} — DB unreachable`,
    ).catch(() => {})
    return
  }

  const emoji = RATING_EMOJI[rating] || ''
  const name = RATING_LABELS[lang]?.[rating] || rating

  await api.editMessageText(
    chatId, messageId,
    `✅ ${lb('processingComplete', lang)}\n${lb('rating', lang)}: ${emoji} ${name} ${label}`,
  ).catch(() => {})
}
