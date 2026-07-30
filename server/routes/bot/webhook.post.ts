import { defineTelegramHandler } from '../../platform/http/auth'
import { AppError } from '../../platform/errors'

export default defineTelegramHandler({
  doc: { method: 'post', path: '/bot/webhook', summary: 'Telegram bot webhook' },
  handler: async ({ event }) => {
    const body = await readBody(event)

    try {
      const { ensureBotReady, bot } = await import('../../utils/bot')
      await ensureBotReady()
      await bot.handleUpdate(body)
      return {}
    } catch (err) {
      console.error('[bot] webhook error:', err)
      throw new AppError('INTERNAL', 500, 'Webhook error')
    }
  },
})
