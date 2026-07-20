import { getHeader } from 'h3'
import { definePublicHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { getIsAdmin } from '../../../utils/auth'
import { getRandomPost } from '../../../lib/posts/repo'

export default definePublicHandler({
  doc: { method: 'get', path: '/api/posts/random', summary: 'Random post (anon: safe only)' },
  handler: async ({ event }) => {
    const cookie = getHeader(event, 'cookie') || ''
    const isAdmin = await getIsAdmin(cookie)
    const post = await getRandomPost(isAdmin)
    if (!post) throw new AppError('NOT_FOUND', 404, 'No posts')
    return post
  },
})
