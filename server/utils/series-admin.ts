/**
 * v0.7.8 PR-C: shared admin post-delete logic with series renumber.
 *
 * Two route handlers call this:
 *   - server/routes/api/admin/posts/[id].delete.ts (admin endpoint)
 *   - server/routes/api/posts/[id].delete.ts     (public path, admin-gated)
 *
 * Both must apply the same series renumber rules — splitting them risks
 * one admin path leaving page_index gaps while the other doesn't.
 */
import { eq, asc, sql } from 'drizzle-orm'
import { posts, postTags, tags } from '../schema'

export async function deletePostAndRenumberSeries(id: string) {
  const target = await db.select().from(posts).where(eq(posts.id, id)).limit(1)
  if (!target[0]) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const t = target[0]

  await db.transaction(async (tx: any) => {
    await tx.update(tags).set({
      postCount: sql`GREATEST(post_count - 1, 0)`,
    }).where(sql`id IN (SELECT tag_id FROM post_tags WHERE post_id = ${id})`)
    await tx.delete(postTags).where(eq(postTags.postId, id))

    if (t.seriesId && t.pageIndex !== null) {
      const survivors = await tx
        .select({ id: posts.id, pageIndex: posts.pageIndex })
        .from(posts)
        .where(eq(posts.seriesId, t.seriesId))
        .orderBy(asc(posts.pageIndex))

      const newCount = survivors.length - 1
      const remaining = survivors.filter((s: { id: string; pageIndex: number | null }) => s.id !== id)
      for (const s of remaining) {
        const newPageIndex = s.pageIndex !== null && s.pageIndex > (t.pageIndex ?? 0)
          ? s.pageIndex - 1
          : s.pageIndex
        await tx.update(posts).set({ pageCount: newCount, pageIndex: newPageIndex }).where(eq(posts.id, s.id))
      }
    }

    await tx.delete(posts).where(eq(posts.id, id))
  })

  await deleteS3Objects(t.s3Key, t.thumbKey, t.previewKey).catch(err =>
    console.error('[deletePostAndRenumberSeries] S3 cleanup failed for', id, err),
  )
}