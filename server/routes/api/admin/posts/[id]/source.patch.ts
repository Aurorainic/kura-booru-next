import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { defineAdminHandler } from '../../../../../platform/http/auth'
import { AppError } from '../../../../../platform/errors'
import { zSourceSite } from '../../../../../platform/schemas/enums'
import { posts } from '../../../../../schema'
import { db } from '../../../../../utils/db'
import { identifySource, resolveSourceOrOther } from '../../../../../utils/url-patterns'
import { serializePost } from '../../../../../lib/posts/serialize'

export default defineAdminHandler({
  schemas: {
    body: z.object({
      source_site: zSourceSite,
      source_id: z.string().trim().min(1).optional(),
    }),
  },
  doc: { method: 'patch', path: '/api/admin/posts/:id/source', summary: 'Update post source classification' },
  handler: async ({ event, body }) => {
    const id = event.context.params?.id as string
    if (!id) throw new AppError('VALIDATION_FAILED', 400, 'Post ID required')

    const existing = await db.select().from(posts).where(eq(posts.id, id)).limit(1)
    if (!existing[0]) throw new AppError('NOT_FOUND', 404, 'Post not found')

    // Reuse the same URL matcher as imports so fixing "other" → "pixiv" also
    // fixes source_id when the original URL is still recognizable.
    const detected = identifySource(existing[0].sourceUrl) || resolveSourceOrOther(existing[0].sourceUrl)
    const sourceId = body.source_id || (
      body.source_site !== 'other' && detected.site === body.source_site ? detected.id : existing[0].sourceId
    )

    // Multi-image series share one source classification — keep all pages in sync
    // so dashboard/source filters don't disagree after one correction.
    const targetIds = existing[0].seriesId
      ? (await db.select({ id: posts.id }).from(posts).where(eq(posts.seriesId, existing[0].seriesId))).map(r => r.id)
      : [id]

    const [updated] = await db
      .update(posts)
      .set({
        sourceSite: body.source_site as any,
        sourceId,
      })
      .where(inArray(posts.id, targetIds))
      .returning()
    if (!updated) throw new AppError('NOT_FOUND', 404, 'Post update failed')

    return serializePost(updated)
  },
})
