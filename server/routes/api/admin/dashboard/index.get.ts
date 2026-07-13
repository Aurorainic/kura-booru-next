import { sql } from 'drizzle-orm'

// API-key callers get the same 30/min/IP rate limit + audit log as
// posts/[id].patch.ts. Admin cookie sessions skip both.
const API_KEY_RATE_LIMIT = 30
const API_KEY_RATE_WINDOW = 60_000

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const apiKey = getHeader(event, 'x-api-key')
  const isAdmin = await getIsAdmin(cookie)
  const hasApiKey = await checkApiKey(apiKey)
  if (!isAdmin && !hasApiKey) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  if (!isAdmin && hasApiKey) {
    const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
    const rlKey = `apikey:rate:${ip}`
    const count = await redis.incr(rlKey)
    if (count === 1) await redis.expire(rlKey, Math.ceil(API_KEY_RATE_WINDOW / 1000))
    if (count > API_KEY_RATE_LIMIT) {
      throw createError({ statusCode: 429, statusMessage: 'Rate limit exceeded' })
    }
    console.warn('[audit] api-key dashboard read', { ip })
  }

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
