import { z } from 'zod'
import { getHeader } from 'h3'
import { definePublicHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { getIsAdmin } from '../../../utils/auth'
import { isSafeModeActive } from '../../../utils/settings'
import { searchPosts } from '../../../lib/posts/repo'

const querySchema = z.object({
  q: z.string().min(1),
  page: z.coerce.number().default(1),
  per_page: z.coerce.number().default(40),
  source: z.string().optional(),
})

export default definePublicHandler({
  schemas: { query: querySchema },
  doc: { method: 'get', path: '/api/search', summary: 'Search posts by tag query' },
  handler: async ({ event, query }) => {
    const cookie = getHeader(event, 'cookie') || ''
    const isAdmin = await getIsAdmin(cookie)
    const safeModeActive = await isSafeModeActive(event)
    const result = await searchPosts(query.q, {
      page: query.page,
      perPage: query.per_page,
      source: query.source,
      isAdmin,
    })
    return {
      ...result,
      items: result.items.map(p => ({ ...p, is_blurred: safeModeActive && p.rating !== 'safe' })),
    }
  },
})
