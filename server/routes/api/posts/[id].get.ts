import { z } from 'zod'
import { getHeader } from 'h3'
import { definePublicHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { getIsAdmin } from '../../../utils/auth'
import { getPost } from '../../../lib/posts/repo'

const paramsSchema = z.object({
  id: z.string().min(1),
})

export default definePublicHandler({
  schemas: { params: paramsSchema },
  doc: { method: 'get', path: '/api/posts/:id', summary: 'Get post by ID (anon: safe only, else 404)' },
  handler: async ({ event, params }) => {
    const cookie = getHeader(event, 'cookie') || ''
    const isAdmin = await getIsAdmin(cookie)
    const post = await getPost(params.id, isAdmin)
    if (!post) throw new AppError('NOT_FOUND', 404, 'Not found')
    return post
  },
})
