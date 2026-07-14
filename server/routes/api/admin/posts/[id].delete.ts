/**
 * Admin-only hard delete for a single post within a series.
 *
 * v0.7.8 PR-C: deletes the post AND rewrites page_index on every later
 * sibling in the same series (transactions so the reorder can't split
 * a read where post N+1 is missing while its page_index says it should
 * be there).
 *
 * - Single-image post (series_id IS NULL): trivial delete. Returns 204.
 * - Series post (page_index=N): delete + UPDATE every post in the same
 *   series with page_index > N to page_index - 1, and decrement
 *   page_count by 1 on every survivor. Stays consistent with the UX
 *   "remaining pages renumber contiguously".
 *
 * NOT supported: undelete. A deleted row's id is gone; restoring it
 * would need to re-stamp series_id, page_index, page_count, and
 * re-upload S3 keys. Out of scope. If you need it, soft-delete with a
 * separate `deleted_at` column is the better model.
 */
import { eq, asc, sql } from 'drizzle-orm'
import { posts } from '../../../../schema'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const id = event.context.params?.id as string
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Post ID required' })

  const target = await db.select().from(posts).where(eq(posts.id, id)).limit(1)
  if (!target[0]) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const t = target[0]

  await db.transaction(async (tx: any) => {
    // Decrement tag post_counts via the post's tag map.
    await tx.update(tags).set({
      postCount: sql`GREATEST(post_count - 1, 0)`,
    }).where(
      sql`id IN (SELECT tag_id FROM post_tags WHERE post_id = ${id})`,
    )
    await tx.delete(postTags).where(eq(postTags.postId, id))

    // Series path: renumber remaining survivors.
    if (t.seriesId && t.pageIndex !== null) {
      // All surviving posts in the same series, ordered by current page_index.
      const survivors = await tx
        .select({ id: posts.id, pageIndex: posts.pageIndex })
        .from(posts)
        .where(eq(posts.seriesId, t.seriesId))
        .orderBy(asc(posts.pageIndex))

      // Drop the to-be-deleted row, then rewrite page_index for everyone
      // who was AFTER the deleted page. Count stays consistent because
      // we delete one and renumber (delete.count - 1) rows; new page_count
      // for survivors is the post-deletion survivor count.
      const newCount = survivors.length - 1
      const remaining: { id: string; pageIndex: number | null }[] = survivors.filter((s: { id: string; pageIndex: number | null }) => s.id !== id)

      for (const s of remaining) {
        const newPageIndex = s.pageIndex !== null && s.pageIndex > (t.pageIndex ?? 0)
          ? s.pageIndex - 1
          : s.pageIndex
        await tx.update(posts)
          .set({ pageCount: newCount, pageIndex: newPageIndex })
          .where(eq(posts.id, s.id))
      }
    }

    await tx.delete(posts).where(eq(posts.id, id))
  })

  // S3 delete after the transaction commits — if it fails, the row is gone
  // and the user gets an orphaned S3 object instead of a broken DB ref.
  await deleteS3Objects(t.s3Key, t.thumbKey, t.previewKey).catch(err =>
    console.error('[admin/posts.delete] S3 cleanup failed for', id, err),
  )

  return new Response(null, { status: 204 })
})
