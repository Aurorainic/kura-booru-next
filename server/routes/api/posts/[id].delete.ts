import { eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const id = event.context.params?.id as string
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Post ID required' })

  const post = await db.select().from(posts).where(eq(posts.id, id)).limit(1)
  if (!post[0]) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  // B-P3-1: Transactional delete with bulk post_count update
  // Run DB transaction first, then delete S3 objects (prefer orphaned S3 over broken DB refs)
  const existingPost = await db.select().from(posts).where(eq(posts.id, id)).limit(1)
  if (!existingPost[0]) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  await db.transaction(async (tx: any) => {
    // Bulk decrement tag post_counts
    await tx.update(tags).set({
      postCount: sql`GREATEST(post_count - 1, 0)`,
    }).where(
      sql`id IN (SELECT tag_id FROM post_tags WHERE post_id = ${id})`,
    )

    await tx.delete(postTags).where(eq(postTags.postId, id))
    await tx.delete(posts).where(eq(posts.id, id))
  })

  // S3 deletion after successful transaction (can't rollback S3)
  await deleteS3Objects(existingPost[0].s3Key, existingPost[0].thumbKey, existingPost[0].previewKey).catch(err =>
    console.error('[posts] S3 delete failed for', id, err),
  )

  return new Response(null, { status: 204 })
})
