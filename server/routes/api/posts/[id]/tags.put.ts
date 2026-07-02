import { eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  const id = event.context.params?.id as string

  // Check post exists before modifying tags
  const postCheck = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1)
  if (!postCheck[0]) throw createError({ statusCode: 404, statusMessage: 'Post not found' })

  const body = await readBody<{ add_tags?: string[]; remove_tag_ids?: string[] }>(event)

  // Remove tags
  if (body?.remove_tag_ids?.length) {
    for (const tagId of body.remove_tag_ids) {
      await db.delete(postTags).where(and(eq(postTags.postId, id), eq(postTags.tagId, tagId)))
      await db.update(tags).set({ postCount: sql`GREATEST(post_count - 1, 0)` }).where(eq(tags.id, tagId))
    }
  }

  // Add tags
  if (body?.add_tags?.length) {
    for (const tagName of body.add_tags) {
      const cleanName = tagName.trim().toLowerCase()
      // B-P3-2: Use onConflictDoUpdate to avoid TOCTOU race; lowercase+trim input
      const [tag] = await db.insert(tags).values({ name: cleanName, category: 'general' })
        .onConflictDoUpdate({ target: tags.name, set: { name: cleanName } })
        .returning()
      if (!tag) throw createError({ statusCode: 500, statusMessage: 'Tag creation failed' })
      // Ensure post_tag exists — use onConflictDoNothing to avoid TOCTOU race
      await db.insert(postTags).values({ postId: id, tagId: tag.id })
        .onConflictDoNothing()
      // Increment post_count
      await db.update(tags).set({ postCount: sql`post_count + 1` }).where(eq(tags.id, tag.id))
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
