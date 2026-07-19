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
