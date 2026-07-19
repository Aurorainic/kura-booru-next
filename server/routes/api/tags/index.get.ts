import { z } from 'zod'
import { getHeader } from 'h3'
import { definePublicHandler } from '../../../platform/http/auth'
import { AppError } from '../../../platform/errors'
import { zTagCategory } from '../../../platform/schemas/enums'
import { getIsAdmin } from '../../../utils/auth'
import { listTags, getTagByName } from '../../../modules/tags/repo'

const querySchema = z.object({
  category: zTagCategory.optional(),
  sort: z.string().default('count'),
  page: z.coerce.number().default(1),
  per_page: z.coerce.number().default(40),
})

export default definePublicHandler({
  schemas: { query: querySchema },
  doc: { method: 'get', path: '/api/tags', summary: 'List tags or get tag by name (catch-all)' },
  handler: async ({ event, query }) => {
    const cookie = getHeader(event, 'cookie') || ''
    const isAdmin = await getIsAdmin(cookie)

    const path = (event.context.params?._ as any)?.toString() || ''

    // /api/tags/:name — the dedicated /api/tags/autocomplete.get.ts handles that
    // exact path; route the catch-all around it so a tag literally named
    // "autocomplete" is still resolvable.
    if (path && path !== 'autocomplete') {
      const tag = await getTagByName(path, isAdmin)
      if (!tag) throw new AppError('NOT_FOUND', 404, 'Tag not found')
      return tag
    }

    // /api/tags (list) — falls through here for both path === '' and the
    // autocomplete branch (which has its own route file and never reaches us).
    return listTags({
      category: query.category,
      sort: query.sort,
      page: query.page,
      perPage: query.per_page,
      isAdmin,
    })
  },
})
