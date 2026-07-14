/**
 * Tag autocomplete — Redis-Search primary, SQL fallback.
 *
 * Enabled via MEILI_ENABLED=true. When the index is missing or redis is
 * down, falls back to the existing SQL ILIKE path. Zero new dependencies —
 * the redis@6 client supports FT.* via sendCommand.
 */
import { sql } from 'drizzle-orm'
import { db } from '../db'
import { tags, posts, postTags } from '../../schema'
import { eq, desc, and, exists } from 'drizzle-orm'
import { getRedis } from '../redis'
import { serializeTag } from '../queries'

const INDEX = 'kura:tagidx'

/**
 * Drop and recreate the index, then bulk-load. Called by the sync plugin
 * at startup and on resync.
 */
export async function rebuildTagIndex(rows: { id: string; name: string; postCount: number; category: string }[]) {
  const rc = await getRedis() as any
  try {
    await rc.sendCommand(['FT.DROPINDEX', INDEX, 'DD'])
  } catch { /* didn't exist — fine */ }
  await rc.sendCommand([
    'FT.CREATE', INDEX,
    'ON', 'HASH',
    'PREFIX', '1', 'tag:',
    'SCHEMA',
    'name', 'TEXT', 'SORTABLE',
    'category', 'TAG',
    'post_count', 'NUMERIC', 'SORTABLE',
  ])
  const pipe = rc.multi()
  for (const t of rows) {
    pipe.sendCommand([
      'HSET', `tag:${t.id}`,
      'name', t.name,
      'category', t.category,
      'post_count', String(t.postCount ?? 0),
    ])
  }
  await pipe.exec()
}

export async function upsertTagIndex(tagId: string, name: string, category: string, postCount: number) {
  const rc = await getRedis() as any
  await rc.sendCommand([
    'HSET', `tag:${tagId}`,
    'name', name,
    'category', category,
    'post_count', String(postCount ?? 0),
  ])
}

export async function deleteTagIndex(tagId: string) {
  const rc = await getRedis() as any
  await rc.del(`tag:${tagId}`)
}

/**
 * Primary entry. Returns up to `perPage` tag suggestions for `prefix`.
 * `isAdmin=false` filters out tags that have only non-safe posts — applied
 * post-fetch via the SQL EXISTS check (cheap with the id subset).
 */
export async function suggestTags(prefix: string, isAdmin: boolean, perPage = 10) {
  if (process.env.MEILI_ENABLED !== 'true') {
    return sqlSuggestTags(prefix, isAdmin, perPage)
  }
  try {
    return await redisSuggestTags(prefix, isAdmin, perPage)
  } catch (err) {
    console.warn('[search] redis-search failed, falling back to SQL:', (err as Error).message)
    return sqlSuggestTags(prefix, isAdmin, perPage)
  }
}

async function redisSuggestTags(prefix: string, isAdmin: boolean, perPage: number) {
  const rc = await getRedis() as any
  // ponytail: \p{L}\p{N} covers all Unicode letters + digits, including CJK
  // Extension B (U+20000+). The old \w/一-龥 regex silently dropped rare
  // kanji / extension ideographs, breaking autocomplete on tags like 𠮷野家.
  const safe = String(prefix || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 64)
  if (!safe) return []
  // FT.SEARCH @name:%…% — substring with typo tolerance (default 1 char).
  // Overshoot 2x; safe-filter drops rows whose posts are all non-safe.
  const result = await rc.sendCommand([
    'FT.SEARCH', INDEX, `@name:%${safe}%`,
    'LIMIT', '0', String(perPage * 3),
    'SORTBY', 'post_count', 'DESC',
  ])
  // Result format: [ total, doc1, [field1, val1, ..], doc2, .. ]
  if (!Array.isArray(result) || result.length < 2) return []
  const total = Number(result[0]) || 0
  if (total === 0) return []
  const ids: string[] = []
  for (let i = 1; i < result.length; i++) {
    const idStr = result[i]
    if (typeof idStr === 'string' && idStr.startsWith('tag:')) {
      ids.push(idStr.slice(4))
    }
  }
  if (!ids.length) return []
  // Hydrate and safe-filter in one query
  const conditions = [sql`id::text = ANY(${sql.raw(`ARRAY[${ids.map((i) => `'${i}'`).join(',')}]`)})`]
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
  const rows = await db.select().from(tags).where(and(...conditions)).limit(perPage)
  return rows.map(serializeTag)
}

async function sqlSuggestTags(prefix: string, isAdmin: boolean, perPage: number) {
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
