import { eq, and, sql } from 'drizzle-orm'
import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/tags/merge', summary: 'Merge tags' },
  handler: async ({ event }) => {
    const body = await readBody<{ source_tag_id: string; target_tag_id: string }>(event)
    if (!body?.source_tag_id || !body?.target_tag_id) {
      throw new AppError('VALIDATION_FAILED', 400, 'source_tag_id and target_tag_id required')
    }

    // B-P2-6: Self-merge check
    if (body.source_tag_id === body.target_tag_id) {
      throw new AppError('VALIDATION_FAILED', 400, '不能合并到自身')
    }

    return db.transaction(async (tx) => {
      const [source, target] = await Promise.all([
        tx.select().from(tags).where(eq(tags.id, body.source_tag_id)).limit(1),
        tx.select().from(tags).where(eq(tags.id, body.target_tag_id)).limit(1),
      ])

      if (!source[0] || !target[0]) throw new AppError('NOT_FOUND', 404, 'Tag not found')

      const targetOldPostCount = target[0].postCount

      // B-P2-6: Count posts that will be moved before moving them
      const countResult = await tx.execute(sql`
        SELECT count(*) AS cnt FROM post_tags
        WHERE tag_id = ${source[0].id}
        AND post_id NOT IN (
          SELECT post_id FROM post_tags WHERE tag_id = ${target[0].id}
        )
      `)
      const postsMoved = Number(countResult[0]?.cnt || 0)
      const postsSkipped = Math.max(0, source[0].postCount - postsMoved)

      // Move post associations: only move posts not already on target
      // ponytail: raw SQL for NOT EXISTS — Drizzle's notExists builder is verbose
      await tx.execute(sql`
        UPDATE post_tags SET tag_id = ${target[0].id}
        WHERE tag_id = ${source[0].id}
        AND post_id NOT IN (
          SELECT post_id FROM post_tags WHERE tag_id = ${target[0].id}
        )
      `)

      // Recalculate target post_count
      await tx.update(tags).set({
        postCount: sql`(SELECT count(*) FROM post_tags WHERE tag_id = ${target[0].id})`,
      }).where(eq(tags.id, target[0].id))

      // Delete source tag (cascades to post_tags + tag_aliases)
      await tx.delete(tags).where(eq(tags.id, source[0].id))

      return {
        merged: true,
        source_tag_id: source[0].id,
        source_tag_name: source[0].name,
        target_tag_id: target[0].id,
        target_tag_name: target[0].name,
        posts_moved: postsMoved,
        posts_skipped: postsSkipped,
        target_old_post_count: targetOldPostCount,
        target_new_post_count: targetOldPostCount + postsMoved,
      }
    })
  },
})
