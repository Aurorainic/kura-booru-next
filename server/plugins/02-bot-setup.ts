/**
 * Bot setup: setWebhook + setMyCommands on startup (T-P1-5, T-P2-7).
 *
 * v0.10.0: 配置从 DB settings 读取（env 仅作引导回退），支持 BOT_PROXY_URL
 * 中转地址（apiRoot 注入由 lib/bot/bot.ts 的 buildBot 处理）。
 *
 * 开关：settings.bot_enabled=false 时不注册 webhook，并尽力调用
 * deleteWebhook 让 Telegram 停止推送（由 syncBotWebhook 统一处理）。
 */

export default defineNitroPlugin(async () => {
  try {
    const { syncBotWebhook } = await import('../utils/bot')
    await syncBotWebhook()
  } catch (err) {
    console.error('[bot-setup] failed to align webhook:', err)
  }
})
