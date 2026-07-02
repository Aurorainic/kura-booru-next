/**
 * Bot setup: setWebhook + setMyCommands on startup.
 * T-P1-5: webhook registration with secret token.
 * T-P2-7: validate SITE_URL and BOT_WEBHOOK_SECRET.
 */

if (!process.env.SITE_URL) {
  console.warn('[bot-setup] SITE_URL not set, webhook registration will fail')
}
if (!process.env.BOT_WEBHOOK_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[bot-setup] BOT_WEBHOOK_SECRET not set in production — webhook is unauthenticated')
}

export default defineNitroPlugin(async () => {
  if (!bot.token) {
    console.warn('[bot-setup] BOT_TOKEN not set, skipping webhook registration')
    return
  }

  const siteUrl = process.env.SITE_URL
  if (!siteUrl) {
    console.warn('[bot-setup] SITE_URL not set, skipping webhook registration')
    return
  }

  try {
    const webhookUrl = `${siteUrl}/bot/webhook`
    const secret = process.env.BOT_WEBHOOK_SECRET

    await bot.api.setWebhook(webhookUrl, {
      secret_token: secret || undefined,
      drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query'],
    })

    await bot.api.setMyCommands([
      { command: 'save', description: '保存图片 / Save image' },
      { command: 'info', description: '查询作品信息 / Post info' },
      { command: 'search', description: '搜索作品 / Search' },
      { command: 'random', description: '随机作品 / Random' },
      { command: 'stats', description: '站点统计 / Stats' },
      { command: 'autopass', description: '自动评级开关 / Toggle autopass' },
      { command: 'lang', description: '切换语言 / Switch language' },
      { command: 'start', description: '开始使用 / Start' },
    ], { scope: { type: 'all_private_chats' } })

    console.log('[bot-setup] webhook registered:', webhookUrl)
  } catch (err) {
    console.error('[bot-setup] webhook registration failed:', err)
  }
})
