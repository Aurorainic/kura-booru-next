
export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const query = getQuery(event)
  const taskIds = (query.task_ids as string || '').split(',').filter(Boolean).slice(0, 50)
  if (!taskIds.length) throw createError({ statusCode: 400, statusMessage: 'task_ids required' })

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const deadline = Date.now() + 5 * 60 * 1000
      let succeeded = 0, too_large = 0, failed = 0

      while (Date.now() < deadline && taskIds.length > 0) {
        for (let i = taskIds.length - 1; i >= 0; i--) {
          const raw = await redis.get(`kura:results:${taskIds[i]}`)
          if (raw) {
            const parsed = JSON.parse(raw)
            await redis.del(`kura:results:${taskIds[i]}`)

            let status: string, detail: string
            if (parsed.status === 'ok') {
              status = 'success'
              detail = '处理完成'
              succeeded++
            } else if (parsed.status === 'too_large') {
              status = 'too_large'
              detail = '图片过大'
              too_large++
            } else {
              status = 'failed'
              detail = parsed.error || ''
              failed++
            }

            send('progress', {
              task_id: taskIds[i],
              status,
              detail,
            })
            taskIds.splice(i, 1)
          }
        }
        if (taskIds.length === 0) break
        send('ping', {})
        await new Promise(r => setTimeout(r, 2000))
      }

      const timed_out = taskIds.length
      send('done', { total: succeeded + too_large + failed + timed_out, succeeded, too_large, failed, timed_out })
      controller.close()
    },
  })

  setResponseHeader(event, 'Content-Type', 'text/event-stream')
  setResponseHeader(event, 'Cache-Control', 'no-cache')
  setResponseHeader(event, 'Connection', 'keep-alive')
  return sendStream(event, stream)
})
