import { getHeader } from 'h3'
import { definePublicHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { getIsAdmin } from '../../../utils/auth'
import { isSafeModeActive } from '../../../utils/settings'
import { getRandomPost } from '../../../lib/posts/repo'

export default definePublicHandler({
  doc: { method: 'get', path: '/api/posts/random', summary: 'Random post (anon: safe only)' },
  handler: async ({ event }) => {
    const cookie = getHeader(event, 'cookie') || ''
    const isAdmin = await getIsAdmin(cookie)
    const safeModeActive = await isSafeModeActive(event)
    const effectiveAdmin = isAdmin && !safeModeActive
    const post = await getRandomPost(effectiveAdmin)
    if (!post) throw new AppError('NOT_FOUND', 404, 'No posts')
    return { ...post, is_blurred: safeModeActive && post.rating !== 'safe' }
  },
})
