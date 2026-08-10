/**
 * Tag autocomplete — PG trgm/ILIKE (ADR-0002). RediSearch impl removed in
 * v0.9.0 (misnamed, half-broken freshness); PG trgm GIN indexes already exist,
 * post_count read live from PG, no drift.
 */
import { eq, and, sql, desc, exists } from 'drizzle-orm'
import { db } from '../../utils/db'
import { tags } from '../../schema/tags'
import { posts } from '../../schema/posts'
import { postTags } from '../../schema/post_tags'
import { serializeTag } from '../posts/serialize'
import { clampPerPage } from '../pagination'

/**
 * Tag suggestions for `prefix`; non-admin sees only tags with safe posts.
 * Prefix match first (B-P3-6), then post_count desc.
 */
export async function suggestTags(prefix: string, isAdmin: boolean, perPage = 10) {
  const conditions = [
    sql`(${tags.name} ILIKE ${prefix + '%'} OR ${tags.name} ILIKE ${'%' + prefix + '%'} OR ${tags.translation} ILIKE ${prefix + '%'} OR ${tags.danbooruName} ILIKE ${prefix + '%'})`,
  ]
  if (!isAdmin) {
    conditions.push(
      exists(
        db.select({ id: postTags.postId })
          .from(postTags)
          .innerJoin(posts, eq(postTags.postId, posts.id))
          .where(and(eq(postTags.tagId, tags.id), eq(posts.rating, 'safe')))
          .limit(1),
      ),
    )
  }

  const rows = await db.select().from(tags)
    .where(and(...conditions))
    .orderBy(
      sql`CASE WHEN ${tags.name} ILIKE ${prefix + '%'} THEN 0 ELSE 1 END`,
      desc(tags.postCount),
    )
    .limit(clampPerPage(perPage))
  return rows.map(serializeTag)
}
