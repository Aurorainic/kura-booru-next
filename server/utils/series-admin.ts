/**
 * Pure renumber math, extracted so it's testable without a DB.
 *
 * Given the survivors (id + current page_index) of a series and the id of
 * the page being deleted (at deletedPageIndex), returns a map of
 * survivorId → new page_index. Survivors after the deleted slot shift down
 * by 1; survivors before keep their index. Caller also needs new page_count
 * = survivors.length (i.e. the input list already excludes the deleted row).
 *
 * `null` page_index on a survivor is treated as "before everything" (legacy
 * row that lost its index) — it's left untouched.
 */
export function renumberSeriesPageIndex(
  survivors: Array<{ id: string; pageIndex: number | null }>,
  deletedPageIndex: number,
): Map<string, number | null> {
  const out = new Map<string, number | null>()
  for (const s of survivors) {
    if (s.pageIndex === null) {
      out.set(s.id, null)
    } else if (s.pageIndex > deletedPageIndex) {
      out.set(s.id, s.pageIndex - 1)
    } else {
      out.set(s.id, s.pageIndex)
    }
  }
  return out
}

// ponytail: one runnable self-check — fails if the renumber math drifts.
// Run with: npx tsx server/utils/series-admin.ts
async function _selfCheck() {
  // delete page 2 from a 1,2,3 series → 1 stays, 3→2
  const m1 = renumberSeriesPageIndex(
    [{ id: 'a', pageIndex: 1 }, { id: 'c', pageIndex: 3 }],
    2,
  )
  if (m1.get('a') !== 1 || m1.get('c') !== 2) {
    console.error('FAIL renumber middle:', m1); process.exit(1)
  }
  // delete page 1 (anchor) → everything shifts down
  const m2 = renumberSeriesPageIndex(
    [{ id: 'b', pageIndex: 2 }, { id: 'c', pageIndex: 3 }],
    1,
  )
  if (m2.get('b') !== 1 || m2.get('c') !== 2) {
    console.error('FAIL renumber anchor:', m2); process.exit(1)
  }
  // delete last page → nothing shifts
  const m3 = renumberSeriesPageIndex(
    [{ id: 'a', pageIndex: 1 }, { id: 'b', pageIndex: 2 }],
    3,
  )
  if (m3.get('a') !== 1 || m3.get('b') !== 2) {
    console.error('FAIL renumber tail:', m3); process.exit(1)
  }
  // null pageIndex survivor untouched
  const m4 = renumberSeriesPageIndex(
    [{ id: 'a', pageIndex: null }],
    2,
  )
  if (m4.get('a') !== null) {
    console.error('FAIL renumber null:', m4); process.exit(1)
  }
  console.log('series-admin renumber self-check: OK')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void _selfCheck()
}

/**
 * v0.7.8 PR-C: shared admin post-delete logic with series renumber.
 *
 * Called from server/routes/api/posts/[id].delete.ts. Series path: delete
 * the row + UPDATE every survivor with page_index > deleted's page_index to
 * page_index - 1, and stamp page_count = new survivor count. Transactional
 * so a reader can't see a gap. Pure renumber math lives in
 * renumberSeriesPageIndex() above; this function applies it row by row.
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
      // Set-based renumber in ONE statement: every survivor after the
      // deleted page_index shifts down by 1; page_count is recomputed to
      // the new survivor count. Replaces the old per-row UPDATE loop (N
      // round-trips). The same statement re-anchors if the deleted row was
      // the anchor (page_index=1): the new lowest survivor's id becomes the
      // series_id for every row — without this, getPost's sibling SELECT
      // would return zero rows and the nav would silently vanish.
      const newCount = await tx
        .select({ count: sql<number>`count(*)` })
        .from(posts)
        .where(sql`${posts.seriesId} = ${t.seriesId} AND ${posts.id} <> ${id}`)
      const survivorCount = Number(newCount[0]?.count || 0)

      // Re-anchor target: the lowest page_index survivor (after the deleted
      // row is gone). If the deleted row wasn't the anchor, series_id is
      // unchanged; we just need the renumber + page_count rewrite.
      const lowestSurvivor = survivorCount > 0
        ? await tx.select({ id: posts.id })
            .from(posts)
            .where(sql`${posts.seriesId} = ${t.seriesId} AND ${posts.id} <> ${id}`)
            .orderBy(asc(posts.pageIndex))
            .limit(1)
        : []
      const isAnchorDelete = t.pageIndex === 1
      const newAnchorId = isAnchorDelete && lowestSurvivor[0] ? lowestSurvivor[0]!.id : null

      await tx.update(posts)
        .set({
          pageCount: survivorCount,
          pageIndex: sql`CASE WHEN ${posts.pageIndex} > ${t.pageIndex} THEN ${posts.pageIndex} - 1 ELSE ${posts.pageIndex} END`,
          ...(newAnchorId ? { seriesId: newAnchorId } : {}),
        })
        .where(sql`${posts.seriesId} = ${t.seriesId} AND ${posts.id} <> ${id}`)
    }

    await tx.delete(posts).where(eq(posts.id, id))
  })

  await deleteS3Objects(t.s3Key, t.thumbKey, t.previewKey).catch(err =>
    console.error('[deletePostAndRenumberSeries] S3 cleanup failed for', id, err),
  )
}