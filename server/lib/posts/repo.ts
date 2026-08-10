import { eq, and, sql, desc, asc, inArray, exists } from 'drizzle-orm'
import { db } from '../../utils/db'
import { posts, tags, postTags, tagAliases } from '../../schema'
import type { Rating } from '../../platform/schemas/enums'
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
    }).from(posts).where(where)
      .orderBy(sql`${posts.createdAt} DESC, ${posts.id} DESC`)
      .limit(perPage).offset(offset),
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

  // v0.7.8 PR-C: fetch sibling pages for the series nav (single-image posts unchanged).
  // SECURITY: anon only sees `safe` siblings (non-safe existence is hidden — 404, never 403);
  // page_count must be the VISIBLE count (pages.length), never the stored hint,
  // else anon could infer hidden non-safe pages exist.
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
    // Attach nav only when >1 visible page: an empty "1 / 1" strip would
    // telegraph hidden non-safe siblings to anon viewers.
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

  // v0.7.8 PR-C: (source_site, source_id) can match a legacy single-image row
  // (page_index IS NULL) plus series pages — order anchor (1) first, then NULL,
  // then rest, else the stale legacy row wins; createdAt breaks ties.
  const result = await db.select().from(posts)
    .where(and(...conditions))
    .orderBy(sql`CASE WHEN ${posts.pageIndex} = 1 THEN 0 WHEN ${posts.pageIndex} IS NULL THEN 1 ELSE 2 END, ${posts.createdAt} ASC`)
    .limit(1)
  if (!result[0]) return serializePost(null)

  // Mirror getPost: attach `series` siblings so by-source clients match the detail API.
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
    db.select().from(posts).where(where)
      .orderBy(sql`${posts.createdAt} DESC, ${posts.id} DESC`)
      .limit(perPage).offset(offset),
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
