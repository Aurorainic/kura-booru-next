/**
 * Auto-rating step — shared by single-image and multi-image paths.
 *
 * ponytail: force_rating (from extension key path) bypasses the rule scan
 * entirely — user-specified rating wins, no auto_rating return value.
 */
import { inArray } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { autoRatingRules } from '../../../schema/auto_rating_rules'

const RATING_RANK: Record<string, number> = { safe: 0, questionable: 1, explicit: 2 }

export async function computeRating(
  tagNames: string[],
  forceRating?: 'safe' | 'questionable' | 'explicit',
): Promise<{ rating: string; autoRating: string | null }> {
  let rating = 'safe'
  let autoRating: string | null = null

  if (forceRating) {
    rating = forceRating
  } else if (tagNames.length > 0) {
    const rules = await db
      .select()
      .from(autoRatingRules)
      .where(inArray(autoRatingRules.tagName, tagNames))

    for (const rule of rules) {
      if (!rule) continue
      const targetRating = rule.targetRating as string
      const rank = RATING_RANK[targetRating] ?? 0
      if (rank > (RATING_RANK[rating] ?? 0)) {
        rating = targetRating
      }
    }
    if (rating !== 'safe') autoRating = rating
  }

  return { rating, autoRating }
}
