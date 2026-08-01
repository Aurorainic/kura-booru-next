import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'

/**
 * 测试 Telegram Bot 连通性：用当前配置（含代理类型/地址）调用 getMe。
 * 请求体可传 { token?, proxyType?, proxyUrl? } 以测试未保存的候选值；
 * 不传则用已保存配置。按代理类型走对应连接方式（http/socks/mtproto）。
 */
export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/settings/test-bot', summary: 'Test Telegram bot connection (getMe)' },
  handler: async ({ event }) => {
    const { getBotConfig } = await import('../../../../utils/settings')
    const { buildBotClient } = await import('../../../../utils/bot-proxy')
    const { Bot } = await import('grammy')
    const body = (await readBody<{ token?: string; proxyType?: string; proxyUrl?: string }>(event).catch(() => ({}))) as { token?: string; proxyType?: string; proxyUrl?: string }
    const saved = await getBotConfig()
    const token = (body?.token || saved.token || '').trim()
    const proxyType = (body?.proxyType ?? saved.proxyType ?? '').trim()
    const proxyUrl = (body?.proxyUrl || saved.proxyUrl || '').trim()

    if (!token) {
      throw new AppError('VALIDATION_FAILED', 400, 'bot_token not configured')
    }

    try {
      const opts: Record<string, any> = {}
      const client = buildBotClient(proxyType, proxyUrl)
      if (client) opts.client = client
      const testBot = new Bot(token, opts)
      const me = await testBot.api.getMe()
      return { ok: true, username: me.username, id: me.id, via: proxyType ? `${proxyType} ${proxyUrl}` : 'direct' }
    } catch (err: any) {
      const msg = err?.message || String(err)
      // Telegram API 错误通常带 description（如 401 Unauthorized）
      const desc = err?.description || err?.error?.description || ''
      return { ok: false, error: desc ? `${desc} (${msg})` : msg }
    }
  },
})
