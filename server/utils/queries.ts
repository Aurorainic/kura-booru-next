import { db } from './db'
import { posts, tags, postTags, tagAliases, autoRatingRules } from '../schema'
import { eq, and, sql, desc, asc, inArray, notInArray, exists } from 'drizzle-orm'
import type { Rating, TagCategory } from '~/types'

// ponytail: re-export drizzle operators needed by route handlers
export { eq, and, sql, desc, asc, inArray, notInArray, exists } from 'drizzle-orm'

// ── Serialization (camelCase Drizzle rows → snake_case API response) ──
// Also strips phash from post objects (security: never expose phash)

export function serializePost(p: any): any {
  if (!p) return null
  return {
    id: p.id,
    s3_key: p.s3Key,
    thumb_key: p.thumbKey,
    preview_key: p.previewKey,
    source_url: p.sourceUrl,
    source_site: p.sourceSite,
    source_id: p.sourceId,
    width: p.width,
    height: p.height,
    file_size: p.fileSize,
    mime_type: p.mimeType,
    title: p.title,
    description: p.description ? sanitizeDescriptionHtml(p.description) : null,
    rating: p.rating,
    created_at: p.createdAt,
    lqip: p.lqip ?? null,
    tags: p.tags?.map((t: any) => serializeTag(t)),
  }
}

export function serializeTag(t: any): any {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    post_count: t.postCount,
    danbooru_name: t.danbooruName ?? null,
    translation: t.translation ?? null,
    ai_processed_at: t.aiProcessedAt ?? null,
  }
}

export function serializeAutoRatingRule(r: any): any {
  return {
    id: r.id,
    tag_name: r.tagName,
    target_rating: r.targetRating,
    created_at: r.createdAt,
  }
}

// ── Search query parsing ──

export interface ParsedQuery {
  includeTags: string[]
  excludeTags: string[]
  rating?: Rating
  sourceSite?: string
  unresolved: string[]
}

export function parseSearchQuery(q: string): ParsedQuery {
  const result: ParsedQuery = { includeTags: [], excludeTags: [], unresolved: [] }
  const tokens = q.split(/[+\s]+/).filter(Boolean)

  for (const token of tokens) {
    // rating:value
    const ratingMatch = token.match(/^rating:(safe|s|questionable|q|explicit|e)$/i)
    if (ratingMatch) {
      const map: Record<string, Rating> = { s: 'safe', q: 'questionable', e: 'explicit' }
      const matched = ratingMatch[1]?.toLowerCase() || ''
      result.rating = map[matched] || matched as Rating
      continue
    }

    // source:value
    const sourceMatch = token.match(/^source:(pixiv|twitter|danbooru|other)$/i)
    if (sourceMatch) {
      result.sourceSite = sourceMatch[1]?.toLowerCase()
      continue
    }

    // -exclude
    if (token.startsWith('-')) {
      result.excludeTags.push(token.slice(1).toLowerCase())
      continue
    }

    // include tag
    result.includeTags.push(token.toLowerCase())
  }

  return result
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

  return serializePost({ ...result[0], tags: postTagRows.map(r => r.tag) })
}

// ponytail: count cache removed — ORDER BY random() doesn't need a count
// first, and the previous OFFSET-by-cache combination was deterministic per
// post within the TTL (offset → time-sorted row).
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

  const result = await db.select().from(posts).where(and(...conditions)).limit(1)
  return serializePost(result[0])
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

// ── Tag queries ──

export async function listTags(opts: {
  category?: TagCategory
  sort?: string
  page?: number
  perPage?: number
  isAdmin?: boolean
}) {
  const page = opts.page || 1
  const perPage = clampPerPage(opts.perPage)
  const offset = (page - 1) * perPage

  const conditions = []
  if (opts.category) conditions.push(eq(tags.category, opts.category as any))

  if (!opts.isAdmin) {
    // B-P1-3: Only show tags that have safe posts, and return SAFE post count (not total)
    const safeCountSubq = db.select({
      tagId: postTags.tagId,
      safeCount: sql<number>`count(*)`.as('safe_count'),
    })
      .from(postTags)
      .innerJoin(posts, eq(postTags.postId, posts.id))
      .where(eq(posts.rating, 'safe'))
      .groupBy(postTags.tagId)
      .as('safe_counts')

    conditions.push(exists(
      db.select().from(safeCountSubq).where(eq(safeCountSubq.tagId, tags.id)),
    ))

    const where = conditions.length ? and(...conditions) : undefined
    const orderBy = opts.sort === 'name' ? asc(tags.name) : desc(tags.postCount)

    const [countResult, items] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(tags).where(where),
      db.select({
        id: tags.id, name: tags.name, category: tags.category,
        // Return safe count instead of total for non-admin
        postCount: safeCountSubq.safeCount, danbooruName: tags.danbooruName, translation: tags.translation,
      }).from(tags)
        .leftJoin(safeCountSubq, eq(safeCountSubq.tagId, tags.id))
        .where(where).orderBy(orderBy).limit(perPage).offset(offset),
    ])

    const total = Number(countResult[0]?.count || 0)
    return { items: items.map(serializeTag), total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) }
  }

  const where = conditions.length ? and(...conditions) : undefined
  const orderBy = opts.sort === 'name' ? asc(tags.name) : desc(tags.postCount)

  const [countResult, items] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(tags).where(where),
    db.select().from(tags).where(where).orderBy(orderBy).limit(perPage).offset(offset),
  ])

  const total = Number(countResult[0]?.count || 0)
  return { items: items.map(serializeTag), total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) }
}

export async function autocompleteTags(prefix: string, isAdmin: boolean, perPage = 10) {
  const conditions = [
    sql`(${tags.name} ILIKE ${prefix + '%'} OR ${tags.name} ILIKE ${'%' + prefix + '%'} OR ${tags.translation} ILIKE ${prefix + '%'} OR ${tags.danbooruName} ILIKE ${prefix + '%'})`,
  ]

  if (!isAdmin) {
    // B-P1-3: Only suggest tags with safe posts — use EXISTS subquery
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

  // Prefix match first (B-P3-6)
  const rows = await db.select().from(tags)
    .where(and(...conditions))
    .orderBy(
      sql`CASE WHEN ${tags.name} ILIKE ${prefix + '%'} THEN 0 ELSE 1 END`,
      desc(tags.postCount),
    )
    .limit(perPage)
  return rows.map(serializeTag)
}

export async function getTagByName(name: string, isAdmin: boolean = false) {
  // Exact match
  const exact = await db.select().from(tags).where(eq(tags.name, name)).limit(1)
  if (exact[0]) {
    if (!isAdmin) {
      // B-P1-3: Check if tag has any safe posts + return safe-only count
      const safeResult = await db.select({
        count: sql<number>`count(*)`,
      })
        .from(postTags)
        .innerJoin(posts, eq(postTags.postId, posts.id))
        .where(and(eq(postTags.tagId, exact[0].id), eq(posts.rating, 'safe')))
      const safeCount = Number(safeResult[0]?.count || 0)
      if (safeCount === 0) return null // hide existence
      return serializeTag({ ...exact[0], postCount: safeCount })
    }
    return serializeTag(exact[0])
  }

  // Alias match
  const alias = await db.select({ tag: tags })
    .from(tagAliases)
    .innerJoin(tags, eq(tagAliases.tagId, tags.id))
    .where(eq(tagAliases.aliasName, name))
    .limit(1)
  if (alias[0]) {
    if (!isAdmin) {
      const safeResult = await db.select({
        count: sql<number>`count(*)`,
      })
        .from(postTags)
        .innerJoin(posts, eq(postTags.postId, posts.id))
        .where(and(eq(postTags.tagId, alias[0].tag.id), eq(posts.rating, 'safe')))
      const safeCount = Number(safeResult[0]?.count || 0)
      if (safeCount === 0) return null
      return serializeTag({ ...alias[0].tag, postCount: safeCount })
    }
    return serializeTag(alias[0].tag)
  }
  return null
}

// ── Auto-rating ──

export async function applyAutoRatingRules(tagNames: string[], currentRating: Rating): Promise<Rating | null> {
  const rules = await db.select().from(autoRatingRules)
    .where(inArray(autoRatingRules.tagName, tagNames))
  if (!rules.length) return null

  const RANK: Record<string, number> = { safe: 0, questionable: 1, explicit: 2 }
  let strictest: Rating | null = null
  for (const rule of rules) {
    const rank = RANK[rule.targetRating] ?? 0
    if (rank > (RANK[currentRating] ?? 0)) {
      if (!strictest || rank > (RANK[strictest] ?? 0)) {
        strictest = rule.targetRating
      }
    }
  }
  return strictest
}

// ── Utility ──

function clampPerPage(n?: number): number {
  const allowed = [20, 40, 100]
  if (!n || !allowed.includes(n)) return 40
  return n
}
