/**
 * Tag autocomplete — PG trgm/ILIKE (ADR-0002).
 *
 * RediSearch implementation removed in v0.9.0: MEILI_ENABLED was a triple
 * misnomer (not Meilisearch, only served autocomplete, index freshness
 * half-broken and unnoticed). PG trgm GIN indexes on tags.name/translation/
 * danbooru_name already exist; this SQL path was the RediSearch fallback and
 * is now the primary — post_count is read live from PG, no drift.
 */
import { eq, and, sql, desc, exists } from 'drizzle-orm'
import { db } from '../../utils/db'
import { tags } from '../../schema/tags'
import { posts } from '../../schema/posts'
import { postTags } from '../../schema/post_tags'
import { serializeTag } from '../posts/serialize'

/**
 * Returns up to `perPage` tag suggestions for `prefix`.
 * `isAdmin=false` filters out tags that have only non-safe posts.
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
    .limit(perPage)
  return rows.map(serializeTag)
}
