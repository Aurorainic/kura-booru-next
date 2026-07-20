import { z } from 'zod'
import { getHeader } from 'h3'
import { definePublicHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { getIsAdmin } from '../../../utils/auth'
import { getPostBySource } from '../../../lib/posts/repo'

const querySchema = z.object({
  source_site: z.string().min(1),
  source_id: z.string().min(1),
})

export default definePublicHandler({
  schemas: { query: querySchema },
  doc: { method: 'get', path: '/api/posts/by-source', summary: 'Get post by source (anon: safe only)' },
  handler: async ({ event, query }) => {
    const cookie = getHeader(event, 'cookie') || ''
    const isAdmin = await getIsAdmin(cookie)
    const post = await getPostBySource(query.source_site, query.source_id, isAdmin)
    if (!post) throw new AppError('NOT_FOUND', 404, 'Not found')
    return post
  },
})
