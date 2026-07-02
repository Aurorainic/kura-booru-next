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
  try {
    const baseUrl = process.env.INTERNAL_API_URL || `http://localhost:${process.env.PORT || 3000}`
    const resp = await fetch(`${baseUrl}/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    })
    if (!resp.ok) console.error('[bot-rating] PATCH failed:', resp.status)
  } catch (err) {
    console.error('[bot-rating] PATCH failed:', err)
  }

  await (redis as any).set(`kura:confirmed_posts:${postId}`, rating, 'EX', 86400)

  const emoji = RATING_EMOJI[rating] || ''
  const name = RATING_LABELS[lang]?.[rating] || rating

  await api.editMessageText(
    chatId, messageId,
    `✅ ${lb('processingComplete', lang)}\n${lb('rating', lang)}: ${emoji} ${name} ${label}`,
  ).catch(() => {})
}
