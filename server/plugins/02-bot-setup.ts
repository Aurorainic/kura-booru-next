/**
 * Bot setup: setWebhook + setMyCommands on startup.
 * T-P1-5: webhook registration with secret token.
 * T-P2-7: validate SITE_URL and BOT_WEBHOOK_SECRET.
 *
 * v0.10.0: 配置从 DB settings 读取（env 仅作引导回退），支持 BOT_PROXY_URL
 * 中转地址（apiRoot 注入由 lib/bot/bot.ts 的 buildBot 处理）。
 */

export default defineNitroPlugin(async () => {
  try {
    const { getBotConfig } = await import('../utils/settings')
    const { getBot } = await import('../utils/bot')

    const cfg = await getBotConfig()
    if (!cfg.token) {
      console.warn('[bot-setup] bot_token not set, skipping webhook registration')
      return
    }
    if (!cfg.siteUrl) {
      console.warn('[bot-setup] site_url not set, skipping webhook registration')
      return
    }

    // ponytail: production webhook without webhook secret = unauthenticated
    // surface that anyone who can reach /bot/webhook can hit. Refuse to register
    // rather than warn-and-continue (matches the SESSION_SECRET guard in auth.ts).
    const secret = cfg.webhookSecret
    if (process.env.NODE_ENV === 'production' && !secret) {
      throw new Error('bot_webhook_secret must be set in production — refusing to register an unauthenticated Telegram webhook')
    }

    try {
      const bot = await getBot()
      const webhookUrl = `${cfg.siteUrl.replace(/\/+$/, '')}/bot/webhook`

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
        { command: 'aitags', description: 'AI 标签处理 / AI tag processing' },
        { command: 'ai', description: 'AI 助手 / AI assistant' },
        { command: 'lang', description: '切换语言 / Switch language' },
        { command: 'start', description: '开始使用 / Start' },
      ], { scope: { type: 'all_private_chats' } })

      console.log('[bot-setup] webhook registered:', webhookUrl, cfg.proxyUrl ? `(via ${cfg.proxyUrl})` : '')
    } catch (err) {
      console.error('[bot-setup] webhook registration failed:', err)
    }
  } catch (err) {
    console.error('[bot-setup] failed to load bot config:', err)
  }
})
