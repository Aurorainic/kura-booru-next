// ARCHIVED (v0.10.0): AI 对话模块已归档，不再注册该路由（契约已移除）。
// 原位置: server/routes/api/admin/ai/chat.post.ts。git 历史可恢复。
import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/ai/chat', summary: 'Admin AI assistant chat' },
  handler: async ({ event }) => {
    const body = await readBody<{ query: string; history?: { role: string; content: string }[]; source?: 'web' | 'bot'; lang?: string }>(event)
    if (!body?.query) throw new AppError('VALIDATION_FAILED', 400, 'query required')

    const reply = await adminAssistantChat(body.query, {
      source: body.source || 'web',
      lang: body.lang,
      history: body.history as any,
    })

    return reply
  },
})
