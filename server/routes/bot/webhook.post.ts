export default defineEventHandler(async (event) => {
  if (!bot.token) {
    throw createError({ statusCode: 503, statusMessage: 'Bot not configured' })
  }

  // T-P0-5: Verify webhook secret token
  const secret = getRequestHeader(event, 'x-telegram-bot-api-secret-token')
  const expectedSecret = process.env.BOT_WEBHOOK_SECRET
  if (expectedSecret && secret !== expectedSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)

  try {
    await ensureBotReady()
    await bot.handleUpdate(body)
    return {}
  } catch (err) {
    console.error('[bot] webhook error:', err)
    throw createError({ statusCode: 500, statusMessage: 'Webhook error' })
  }
})
