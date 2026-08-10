import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'get', path: '/api/tasks/web-import/stream', summary: 'SSE stream for web-import task progress' },
  handler: async ({ event }) => {
    const query = getQuery(event)
    const rawTaskIds = query.task_ids
    const taskIds = (Array.isArray(rawTaskIds) ? rawTaskIds : [rawTaskIds])
      .flatMap(v => String(v || '').split(',').filter(Boolean))
      .slice(0, 50)
    if (!taskIds.length) throw new AppError('VALIDATION_FAILED', 400, 'task_ids required')

    const ac = new AbortController()
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const send = (event: string, data: any) => {
          // 客户端断开后 enqueue 抛 TypeError — 由循环 try/catch 捕获清理
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

        const deadline = Date.now() + 5 * 60 * 1000
        let succeeded = 0, too_large = 0, failed = 0

        try {
          while (!ac.signal.aborted && Date.now() < deadline && taskIds.length > 0) {
            for (let i = taskIds.length - 1; i >= 0; i--) {
              const raw = await redis.get(`kura:results:${taskIds[i]}`)
              if (raw) {
                let parsed: any
                try { parsed = JSON.parse(raw) }
                catch { parsed = { status: 'error', error: 'malformed result data' } }

                // 竞态修复：只消费 pipeline-worker 覆盖后的最终结果（success/duplicate/
                // too_large/failed）；sidecar 原始结果（ok/error）跳过不删 — 提前 del 会让
                // pipeline 读到 null 导致任务悬空（no result）。
                if (!['success', 'duplicate', 'too_large', 'failed'].includes(parsed.status)) continue

                await redis.del(`kura:results:${taskIds[i]}`)

                let status: string, detail: string
                // Pipeline writes { success, failed, too_large, duplicate } (see processResult in pipeline.ts)
                if (parsed.status === 'success') {
                  status = 'success'
                  detail = '处理完成'
                  succeeded++
                } else if (parsed.status === 'duplicate') {
                  status = 'duplicate'
                  detail = '重复图片已存在'
                  succeeded++ // already in DB — count as success from the user's perspective
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
        } catch {
          // 客户端断开（enqueue 抛 TypeError）或流被取消：停止轮询，不再发 done
          return
        } finally {
          ac.abort()
        }
        controller.close()
      },
      cancel() {
        // 客户端断开：中止轮询循环，释放 Redis 轮询
        ac.abort()
      },
    })

    setResponseHeader(event, 'Content-Type', 'text/event-stream')
    setResponseHeader(event, 'Cache-Control', 'no-cache')
    setResponseHeader(event, 'Connection', 'keep-alive')
    return sendStream(event, stream)
  },
})
