import { eq, sql, inArray } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const id = event.context.params?.id as string

  // Check post exists before modifying tags
  const postCheck = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1)
  if (!postCheck[0]) throw createError({ statusCode: 404, statusMessage: 'Post not found' })

  const body = await readBody<{ add_tags?: string[]; remove_tag_ids?: string[] }>(event)

  // Remove tags (bulk): single DELETE for all tagIds, then single UPDATE to decrement counts
  if (body?.remove_tag_ids?.length) {
    const removeIds = [...new Set(body.remove_tag_ids)]
    await db.delete(postTags).where(and(eq(postTags.postId, id), inArray(postTags.tagId, removeIds)))
    await db.update(tags).set({ postCount: sql`GREATEST(post_count - 1, 0)` }).where(inArray(tags.id, removeIds))
  }

  // Add tags (bulk): upsert all names, then insert post_tag links, then increment counts only for new links
  if (body?.add_tags?.length) {
    const cleanNames = [...new Set(body.add_tags.map(n => n.trim().toLowerCase()).filter(Boolean))]
    if (cleanNames.length) {
      // B-P3-2: Use onConflictDoUpdate to avoid TOCTOU race
      const upserted = await db.insert(tags).values(
        cleanNames.map(name => ({ name, category: 'general' as const })),
      )
        .onConflictDoUpdate({ target: tags.name, set: { name: sql`excluded.name` } })
        .returning({ id: tags.id })
      if (upserted.length === 0) throw createError({ statusCode: 500, statusMessage: 'Tag upsert failed' })

      const tagIds = upserted.map(t => t.id)
      const inserted = await db.insert(postTags).values(
        tagIds.map(tagId => ({ postId: id, tagId })),
      )
        .onConflictDoNothing()
        .returning({ tagId: postTags.tagId })

      // Increment count only for newly linked tags. onConflictDoNothing is a no-op
      // when the (postId, tagId) row already exists, so we must derive new links
      // from the RETURNING set, not from the upserted set.
      const newTagIds = inserted.map(r => r.tagId)
      if (newTagIds.length) {
        await db.update(tags).set({ postCount: sql`post_count + 1` }).where(inArray(tags.id, newTagIds))
      }
    }
  }

  // Return updated post
  const post = await db.select().from(posts).where(eq(posts.id, id)).limit(1)
  const postTagRows = await db.select({ tag: tags })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(eq(postTags.postId, id))

  return serializePost({ ...post[0], tags: postTagRows.map(r => r.tag) })
})
