import { z } from 'zod'
import { getHeader } from 'h3'
import { definePublicHandler } from '../../../platform/http/auth'
import { getIsAdmin } from '../../../utils/auth'
import { suggestTags } from '../../../lib/search/suggest'

const querySchema = z.object({
  q: z.string().min(1),
  per_page: z.coerce.number().default(10),
})

export default definePublicHandler({
  schemas: { query: querySchema },
  doc: { method: 'get', path: '/api/tags/autocomplete', summary: 'Tag autocomplete (PG trgm/ILIKE, ADR-0002)' },
  handler: async ({ event, query }) => {
    const cookie = getHeader(event, 'cookie') || ''
    const isAdmin = await getIsAdmin(cookie)
    return suggestTags(query.q, isAdmin, query.per_page)
  },
})
