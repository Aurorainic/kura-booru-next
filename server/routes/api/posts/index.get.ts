import { z } from 'zod'
import { getHeader } from 'h3'
import { definePublicHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { zRating } from '../../../platform/schemas/enums'
import { getIsAdmin } from '../../../utils/auth'
import { isSafeModeActive } from '../../../utils/settings'
import { listPosts } from '../../../lib/posts/repo'

const querySchema = z.object({
  page: z.coerce.number().default(1),
  per_page: z.coerce.number().default(40),
  rating: zRating.optional(),
  q: z.string().optional(),
})

export default definePublicHandler({
  schemas: { query: querySchema },
  doc: { method: 'get', path: '/api/posts', summary: 'List posts (anon: safe only)' },
  handler: async ({ event, query }) => {
    // Search is on /api/search — don't piggyback ?q= on the list endpoint.
    if (query.q) {
      throw new AppError('VALIDATION_FAILED', 400, 'Use /api/search for queries')
    }
    const cookie = getHeader(event, 'cookie') || ''
    const isAdmin = await getIsAdmin(cookie)
    const safeModeActive = await isSafeModeActive(event)
    const effectiveAdmin = isAdmin && !safeModeActive
    const result = await listPosts({
      page: query.page,
      perPage: query.per_page,
      rating: query.rating,
      isAdmin: effectiveAdmin,
    })
    return {
      ...result,
      items: result.items.map(p => ({ ...p, is_blurred: safeModeActive && p.rating !== 'safe' })),
    }
  },
})
