// v0.9.0 R2.5: split from server/utils/ai.ts. Merge suggestions (capability ②).

import { eq, and, sql, desc, asc } from 'drizzle-orm'
import { db } from '../../utils/db'
import { tags } from '../../schema'
import type { TagCategory } from '~/types'
import { callAi } from './client'
import type { MergeSuggestion } from './types'

// ── Merge suggestions (capability ②) ──

export async function suggestMerges(scope: 'all' | { category: TagCategory }): Promise<MergeSuggestion[]> {
  const where = scope === 'all' ? undefined : eq(tags.category, scope.category as any)
  // ponytail: duplicates are most common among LOW-count tags (typos, variant
  // romanizations, partial names). The previous code ordered by post_count DESC
  // and took the top 200 - exactly the tags least likely to need merging.
  // Strategy: take a mix - top 50 by count (canonical candidates) + bottom 150
  // by count ascending (likely duplicates). Exclude zero-count tags (orphans
  // with no posts can't be "duplicates" of anything meaningful).
  const [highCount, lowCount] = await Promise.all([
    db.select().from(tags)
      .where(where ? and(where, sql`${tags.postCount} > 0`) : sql`${tags.postCount} > 0`)
      .orderBy(desc(tags.postCount))
      .limit(50),
    db.select().from(tags)
      .where(where ? and(where, sql`${tags.postCount} > 0`) : sql`${tags.postCount} > 0`)
      .orderBy(asc(tags.postCount))
      .limit(150),
  ])

  // Deduplicate (a tag might appear in both if count is near the boundary)
  const seen = new Set<string>()
  const tagRows = [...highCount, ...lowCount].filter(t => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })

  if (!tagRows.length) return []

  const tagInfo = tagRows.map(t => `${t.name} (${t.category}, count:${t.postCount}${t.translation ? `, zh:${t.translation}` : ''})`)

  const raw = await callAi([
    {
      role: 'system',
      content: `You are a booru tag system analyzer. Given a list of tags, identify groups of tags that likely refer to the same concept and should be merged. Consider: spelling variants, translations, abbreviated forms, character name variants.

Rules:
- Only suggest merging tags WITHIN THE SAME category (e.g. two 'character' tags can merge, but a 'character' tag should never merge with an 'artist' tag even if names are similar)
- Only suggest merges you are confident about (confidence >= 0.6)
- canonical_name should be the most correct/standard form (prefer higher post_count, proper romanization)
- If no merges are needed, return { "groups": [] }

Return JSON: { "groups": [{ "canonical_name": "best_tag_name", "aliases": ["alt1", "alt2"], "reason": "brief explanation", "confidence": 0.0_to_1.0 }] }`,
    },
    { role: 'user', content: tagInfo.join('\n') },
  ], { json: true })

  try {
    const parsed = JSON.parse(raw)
    return (parsed.groups || []).filter((g: any) => (g.confidence || 0) >= 0.6)
  } catch {
    console.error('[ai] suggestMerges: failed to parse AI response')
    return []
  }
}
