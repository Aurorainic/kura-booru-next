export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const body = await readBody<{ query: string; history?: { role: string; content: string }[]; source?: 'web' | 'bot'; lang?: string }>(event)
  if (!body?.query) throw createError({ statusCode: 400, statusMessage: 'query required' })

  const reply = await adminAssistantChat(body.query, {
    source: body.source || 'web',
    lang: body.lang,
    history: body.history as any,
  })

  return reply
})
