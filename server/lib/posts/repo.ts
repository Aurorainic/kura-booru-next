import { eq, and, sql, desc, asc, inArray, exists } from 'drizzle-orm'
import { db } from '../../utils/db'
import { posts, tags, postTags, tagAliases } from '../../schema'
import type { Rating } from '~/types'
import { clampPerPage } from '../pagination'
import { serializePost } from './serialize'
import { parseSearchQuery } from '../search/parser'

// ── Post queries ──

export async function listPosts(opts: {
  page?: number
  perPage?: number
  rating?: Rating
  isAdmin?: boolean
}) {
  const page = opts.page || 1
  const perPage = clampPerPage(opts.perPage)
  const offset = (page - 1) * perPage

  const conditions = []
  if (!opts.isAdmin) conditions.push(eq(posts.rating, 'safe'))
  else if (opts.rating) conditions.push(eq(posts.rating, opts.rating))

  const where = conditions.length ? and(...conditions) : undefined

  const [countResult, items] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(posts).where(where),
    db.select({
      id: posts.id, s3Key: posts.s3Key, thumbKey: posts.thumbKey, previewKey: posts.previewKey,
      sourceUrl: posts.sourceUrl, sourceSite: posts.sourceSite, sourceId: posts.sourceId,
      width: posts.width, height: posts.height, fileSize: posts.fileSize, mimeType: posts.mimeType,
      title: posts.title, description: posts.description, rating: posts.rating, createdAt: posts.createdAt,
    }).from(posts).where(where).orderBy(desc(posts.createdAt)).limit(perPage).offset(offset),
  ])

  const total = Number(countResult[0]?.count || 0)
  return { items: items.map(serializePost), total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) }
}

export async function getPost(id: string, isAdmin: boolean) {
  const conditions = [eq(posts.id, id)]
  if (!isAdmin) conditions.push(eq(posts.rating, 'safe'))

  const result = await db.select().from(posts).where(and(...conditions)).limit(1)
  if (!result[0]) return null

  // Fetch tags
  const postTagRows = await db.select({ tag: tags })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(eq(postTags.postId, id))

  const post = serializePost({ ...result[0], tags: postTagRows.map(r => r.tag) })

  // v0.7.8 PR-C: if this post belongs to a series, fetch the sibling pages
  // for the series nav. Single-image posts return unchanged.
  //
  // SECURITY: anonymous viewers must only see `safe` siblings — non-safe
  // existence is hidden (the project's content-rating contract: non-safe
  // returns 404, never 403). So the sibling fetch is gated to safe rows
  // for anon, mirroring the post's own access level. page_count is the
  // VISIBLE count (pages.length), never the stored hint — otherwise anon
  // could infer "this series has 5 pages but I only see 2" → metadata leak
  // about hidden non-safe pages.
  if (post && result[0].seriesId) {
    const siblingConds = [eq(posts.seriesId, result[0].seriesId)]
    if (!isAdmin) siblingConds.push(eq(posts.rating, 'safe'))
    const pages = await db
      .select({
        id: posts.id,
        pageIndex: posts.pageIndex,
        thumbKey: posts.thumbKey,
        width: posts.width,
        height: posts.height,
      })
      .from(posts)
      .where(and(...siblingConds))
      .orderBy(asc(posts.pageIndex))
    // Only attach the series nav if there's >1 visible page. A series with
    // 1 visible page (anon viewing the lone safe page of a non-safe series)
    // would render an empty "1 / 1" strip with nothing to navigate to —
    // hide it instead so the existence of hidden siblings isn't telegraphed.
    if (pages.length > 1) {
      post.series = {
        id: result[0].seriesId,
        page_count: pages.length,
        pages: pages.map(p => ({
          id: p.id,
          page_index: p.pageIndex,
          thumb_key: p.thumbKey,
          width: p.width,
          height: p.height,
        })),
      }
    }
  }

  return post
}

// ponytail: count cache removed — ORDER BY random() doesn't need a count
// first, and the previous OFFSET-by-cache combination was deterministic per
// post within the TTL (offset → time-sorted row).
// ponytail: ORDER BY random() is O(N) seq-scan + sort; fine to ~100k posts.
// At 1M+ rows, switch to `WHERE id = (SELECT id FROM posts TABLESAMPLE
// SYSTEM(0.1) LIMIT 1)` — approximate but O(sampled) and indexable.
export async function getRandomPost(isAdmin: boolean) {
  const where = !isAdmin ? eq(posts.rating, 'safe') : undefined

  const result = await db.select().from(posts).where(where).orderBy(sql`random()`).limit(1)
  if (!result[0]) return null

  const postTagRows = await db.select({ tag: tags })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(eq(postTags.postId, result[0].id))

  return serializePost({ ...result[0], tags: postTagRows.map(r => r.tag) })
}

export async function getPostBySource(sourceSite: string, sourceId: string, isAdmin: boolean) {
  const conditions = [eq(posts.sourceSite, sourceSite as any), eq(posts.sourceId, sourceId)]
  if (!isAdmin) conditions.push(eq(posts.rating, 'safe'))

  // v0.7.8 PR-C: after multi-image series, a (source_site, source_id) tuple
  // can match multiple rows — a legacy single-image row (page_index IS NULL)
  // and up to 5 series pages. Without an ORDER BY the planner picks any row;
  // with NULLs-last default ordering the legacy row would win over the
  // series anchor, returning a stale post for a re-imported illust.
  // Anchor (page_index=1) first, then NULL (legacy single-image), then the
  // rest. CreatedAt breaks ties deterministically.
  const result = await db.select().from(posts)
    .where(and(...conditions))
    .orderBy(sql`CASE WHEN ${posts.pageIndex} = 1 THEN 0 WHEN ${posts.pageIndex} IS NULL THEN 1 ELSE 2 END, ${posts.createdAt} ASC`)
    .limit(1)
  if (!result[0]) return serializePost(null)

  // Mirror getPost: if the matched row is part of a series, attach the
  // sibling-pages `series` field so bot/by-source clients see the same
  // surface as the detail-page API.
  return getPost(result[0].id, isAdmin)
}

// ── Search ──

export async function searchPosts(q: string, opts: {
  page?: number
  perPage?: number
  source?: string
  isAdmin?: boolean
}) {
  const parsed = parseSearchQuery(q)
  const page = opts.page || 1
  const perPage = clampPerPage(opts.perPage)
  const offset = (page - 1) * perPage

  // Resolve include tags (B-P3-7: separate IDs for SQL, names for response) — single IN(.) lookup
  const resolvedIncludeIds: string[] = []
  const resolvedIncludeNames: string[] = []
  const resolvedExcludeIds: string[] = []
  const unresolved: string[] = []
  const allNames = [...parsed.includeTags, ...parsed.excludeTags]
  if (allNames.length) {
    const rows = await db.select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(inArray(tags.name, allNames))
    const byName = new Map(rows.map(r => [r.name, r]))
    for (const name of parsed.includeTags) {
      const tag = byName.get(name)
      if (tag) { resolvedIncludeIds.push(tag.id); resolvedIncludeNames.push(tag.name) }
      else unresolved.push(name)
    }
    for (const name of parsed.excludeTags) {
      const tag = byName.get(name)
      if (tag) resolvedExcludeIds.push(tag.id)
    }
  }

  // If no include tags resolved and we have unresolved, return empty
  if (resolvedIncludeIds.length === 0 && parsed.includeTags.length > 0) {
    return {
      items: [], total: 0, page, per_page: perPage, total_pages: 0,
      resolved_tags: [], unresolved_tags: [...unresolved, ...parsed.includeTags],
    }
  }

  // Build conditions
  const conditions = []
  if (!opts.isAdmin) conditions.push(eq(posts.rating, 'safe'))
  else if (parsed.rating) conditions.push(eq(posts.rating, parsed.rating))

  if (opts.source || parsed.sourceSite) {
    conditions.push(eq(posts.sourceSite, (opts.source || parsed.sourceSite) as any))
  }

  // Include tags: EXISTS subqueries
  for (const tagId of resolvedIncludeIds) {
    conditions.push(
      exists(
        db.select({ id: postTags.postId })
          .from(postTags)
          .where(and(eq(postTags.tagId, tagId), eq(postTags.postId, posts.id)))
      )
    )
  }

  // Exclude tags: NOT EXISTS
  for (const tagId of resolvedExcludeIds) {
    conditions.push(
      sql`NOT EXISTS (${db.select({ id: postTags.postId })
        .from(postTags)
        .where(and(eq(postTags.tagId, tagId), eq(postTags.postId, posts.id)))})`
    )
  }

  const where = conditions.length ? and(...conditions) : undefined

  const [countResult, items] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(posts).where(where),
    db.select().from(posts).where(where).orderBy(desc(posts.createdAt)).limit(perPage).offset(offset),
  ])

  // Fetch tags for all items
  const postIds = items.map(p => p.id)
  const allPostTags = postIds.length ? await db.select({ postId: postTags.postId, tag: tags })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(inArray(postTags.postId, postIds)) : []

  const tagMap = new Map<string, any[]>()
  for (const pt of allPostTags) {
    if (!tagMap.has(pt.postId)) tagMap.set(pt.postId, [])
    tagMap.get(pt.postId)!.push(pt.tag)
  }

  const total = Number(countResult[0]?.count || 0)
  return {
    items: items.map(p => serializePost({ ...p, tags: tagMap.get(p.id) || [] })),
    total, page, per_page: perPage, total_pages: Math.ceil(total / perPage),
    resolved_tags: resolvedIncludeNames,
    unresolved_tags: unresolved,
  }
}

// ── Tag resolution (exact → alias → fuzzy) ──
// ponytail: no external callers found at migration time; kept for potential
// future use (search tag-resolution path). If still dead at R3.3, delete.

export async function resolveTag(name: string) {
  // 1. Exact match
  const exact = await db.select().from(tags).where(eq(tags.name, name)).limit(1)
  if (exact[0]) return exact[0]

  // 2. Alias match
  const alias = await db.select({ tag: tags })
    .from(tagAliases)
    .innerJoin(tags, eq(tagAliases.tagId, tags.id))
    .where(eq(tagAliases.aliasName, name))
    .limit(1)
  if (alias[0]) return alias[0].tag

  // 3. Fuzzy match (pg_trgm)
  const fuzzy = await db.select().from(tags)
    .where(sql`(${tags.name} ILIKE ${'%' + name + '%'} OR ${tags.translation} ILIKE ${'%' + name + '%'} OR ${tags.danbooruName} ILIKE ${'%' + name + '%'})`)
    .orderBy(desc(tags.postCount))
    .limit(1)
  if (fuzzy[0]) return fuzzy[0]

  return null
}
