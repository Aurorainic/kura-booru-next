import { eq, and, sql, desc, asc, exists } from 'drizzle-orm'
import { db } from '../../utils/db'
import { posts } from '../../schema/posts'
import { tags } from '../../schema/tags'
import { postTags } from '../../schema/post_tags'
import { tagAliases } from '../../schema/tag_aliases'
import type { TagCategory } from '~/types'
import { clampPerPage } from '../pagination'
import { serializeTag } from '../posts/serialize'

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
