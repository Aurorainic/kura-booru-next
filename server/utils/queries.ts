import { inArray } from 'drizzle-orm'
import { db } from './db'
import { autoRatingRules } from '../schema'
import type { Rating } from '~/types'

// v0.9.0 R2.2: queries.ts split into lib/. This file is now a re-export
// point (backward compat for Nitro auto-import consumers) + the auto-rating
// query, which stays here until R2.5 migrates the admin domain.
//
// Drizzle operators re-export deleted (was L7): consumers import from
// 'drizzle-orm' directly. clampPerPage moved to lib/pagination.ts.

export { serializePost, serializeTag, serializeAutoRatingRule } from '../lib/posts/serialize'
export { parseSearchQuery, type ParsedQuery } from '../lib/search/parser'
export { listPosts, getPost, getRandomPost, getPostBySource, searchPosts, resolveTag } from '../lib/posts/repo'
export { listTags, autocompleteTags, getTagByName } from '../lib/tags/repo'

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
