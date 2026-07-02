import { sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const apiKey = getHeader(event, 'x-api-key')
  const isAdmin = await getIsAdmin(cookie)
  const hasApiKey = await checkApiKey(apiKey)
  if (!isAdmin && !hasApiKey) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // Overview
  const [postCount, tagCount, postTagCount, fileSizeSum, sourceBreakdown, ratingBreakdown, topTags, recentPosts] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(posts),
    db.select({ count: sql<number>`count(*)` }).from(tags),
    db.select({ count: sql<number>`count(*)` }).from(postTags),
    db.select({ sum: sql<bigint>`coalesce(sum(file_size), 0)` }).from(posts),
    db.select({ sourceSite: posts.sourceSite, count: sql<number>`count(*)` }).from(posts).groupBy(posts.sourceSite),
    db.select({ rating: posts.rating, count: sql<number>`count(*)` }).from(posts).groupBy(posts.rating),
    db.select({ id: tags.id, name: tags.name, category: tags.category, postCount: tags.postCount }).from(tags).orderBy(sql`post_count desc`).limit(10),
    db.select({ id: posts.id, thumbKey: posts.thumbKey, title: posts.title, rating: posts.rating, sourceSite: posts.sourceSite, createdAt: posts.createdAt }).from(posts).orderBy(sql`created_at desc`).limit(6),
  ])

  return {
    overview: {
      total_posts: Number(postCount[0]?.count || 0),
      total_tags: Number(tagCount[0]?.count || 0),
      total_post_tags: Number(postTagCount[0]?.count || 0),
      total_file_size_bytes: Number(fileSizeSum[0]?.sum || 0),
    },
    source_breakdown: sourceBreakdown.map((s: any) => ({ source_site: s.sourceSite, count: s.count })),
    rating_breakdown: ratingBreakdown,
    top_tags: topTags.map((t: any) => ({ id: t.id, name: t.name, category: t.category, post_count: t.postCount })),
    recent_posts: recentPosts.map((p: any) => ({ id: p.id, thumb_key: p.thumbKey, title: p.title, rating: p.rating, source_site: p.sourceSite, created_at: p.createdAt })),
  }
})
