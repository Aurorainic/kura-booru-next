// v0.9.0 R2.5: split from server/utils/ai.ts. Rating suggestions (capability ③ + Bot capability ⑤).

import { eq, and, desc } from 'drizzle-orm'
import { db } from '../../utils/db'
import { posts, postTags, tags } from '../../schema'
import type { Rating } from '~/types'
import { callAi } from './client'
import { isAiEnabled } from './config'
import { chunk } from './utility'
import type { RatingSuggestion } from './types'

// ── Rating suggestions (capability ③ + Bot capability ⑤) ──

export async function suggestRatingForPost(postId: string): Promise<RatingSuggestion | null> {
  if (!isAiEnabled()) return null

  const postRows = await db.select().from(posts).where(eq(posts.id, postId)).limit(1)
  if (!postRows[0]) return null

  const post = postRows[0]
  const postTagRows = await db.select({ tag: tags })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(eq(postTags.postId, postId))

  // ponytail: weight tags by signal strength. A tag like "nude" or "panties"
  // is a much stronger rating signal than "long_hair" or "blue_eyes". Without
  // weighting, the AI treats all tags equally and may be misled by neutral
  // tags outnumbering suggestive ones.
  const STRONG_SIGNALS = new Set([
    'nude', 'naked', 'topless', 'bottomless', 'panties', 'bra', 'underwear',
    'nipples', 'areola', 'cleavage', 'cameltoe', 'ass', 'butt', 'breasts',
    'penis', 'vagina', 'cum', 'sex', 'masturbation', 'oral', 'penetration',
    'nude_filter', 'nudity', 'explicit',
    'bikini', 'swimsuit', 'lingerie', 'pantyhose', 'thighhighs',
    'panty_shot', 'underboob', 'sideboob', 'cleavage',
    'ecchi', 'hentai', 'roulai', '18+',
  ])
  const tagInfo = postTagRows.map(r => {
    const isStrong = STRONG_SIGNALS.has(r.tag.name.toLowerCase()) ||
      STRONG_SIGNALS.has((r.tag.danbooruName || '').toLowerCase())
    const signal = isStrong ? '[STRONG]' : ''
    return `${r.tag.name}${signal} (${r.tag.category}${r.tag.translation ? `, ${r.tag.translation}` : ''})`
  })

  // ponytail: include image dimensions - a very tall narrow image is likely
  // a manga/doujin page (higher explicit probability), while a wide landscape
  // image is more likely a safe illustration. This is a weak signal but
  // better than nothing when we can't see the actual image.
  const aspectRatio = post.width && post.height ? (post.width / post.height).toFixed(2) : 'unknown'
  const orientation = aspectRatio === 'unknown' ? 'unknown' : (Number(aspectRatio) > 1.2 ? 'landscape' : Number(aspectRatio) < 0.8 ? 'portrait' : 'square')

  const raw = await callAi([
    {
      role: 'system',
      content: `You are an anime image content rater for a booru-style gallery. You rate posts based on metadata and tags ONLY (you cannot see the image).

Ratings (booru convention):
- safe: General-audience content. Fully clothed characters, no suggestive elements, no revealing clothing. Even mild fanservice like panty shots disqualify from safe.
- questionable: Suggestive or mildly mature content. Includes: ecchi, swimsuits, lingerie, suggestive poses, panty shots, visible underwear, provocative clothing, non-explicit fanservice.
- explicit: Clearly adult/NSFW content. Includes: nudity, sexual acts, visible genitals, hentai.

Tags marked [STRONG] are strong rating signals - weight them heavily in your assessment.

If most [STRONG] tags suggest mature content but you're not certain it's explicit, lean questionable rather than explicit.
If there are no [STRONG] tags, the post is very likely safe - only rate higher if the title/description clearly indicates mature content.

Return JSON: { "rating": "safe|questionable|explicit", "confidence": 0.0_to_1.0, "reason": "brief explanation referencing specific tags" }`,
    },
    {
      role: 'user',
      content: `Title: ${post.title || '(none)'}\nDescription: ${(post.description || '').slice(0, 300)}\nSource: ${post.sourceSite}\nImage: ${post.width}x${post.height} (${orientation}, ratio ${aspectRatio})\nTags: ${tagInfo.join(', ')}`,
    },
  ], { json: true })

  try {
    const parsed = JSON.parse(raw)
    const validRatings: Rating[] = ['safe', 'questionable', 'explicit']
    const rating = validRatings.includes(parsed.rating) ? parsed.rating : 'safe'
    return {
      rating,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      reason: String(parsed.reason || ''),
    }
  } catch {
    console.error('[ai] suggestRatingForPost: failed to parse AI response')
    return null
  }
}

export async function suggestRatings(
  scope: 'unrated' | 'all' | { rating: Rating },
  limit = 50,
  onProgress?: (examined: number, total: number) => void,
): Promise<(RatingSuggestion & { post_id: string; current_rating: Rating })[]> {
  const conditions = []
  if (scope === 'unrated') {
    conditions.push(eq(posts.rating, 'safe'))
  } else if (typeof scope === 'object') {
    conditions.push(eq(posts.rating, scope.rating as any))
  }

  const where = conditions.length ? and(...conditions) : undefined
  const postRows = await db.select().from(posts).where(where).orderBy(desc(posts.createdAt)).limit(limit)

  const results: (RatingSuggestion & { post_id: string; current_rating: Rating })[] = []
  let examined = 0

  // ponytail: avoid concurrent bursts on the AI API - process sequentially in
  // small batches with a 200ms inter-request delay. Previous Promise.all fired
  // 10 requests simultaneously; that triggered 429s and was hostile to shared endpoints.
  for (const batch of chunk(postRows, 5)) {
    for (const post of batch) {
      try {
        const suggestion = await suggestRatingForPost(post.id)
        if (suggestion && suggestion.rating !== post.rating) {
          results.push({
            ...suggestion,
            post_id: post.id,
            current_rating: post.rating as Rating,
          })
        }
      } catch { /* skip */ }
      // ponytail: report progress per-post examined, not per-suggestion-found.
      // Counting only changed-rating posts made progress stall at 0 until the
      // very end, giving the admin no feedback during a long scan.
      examined++
      if (onProgress) onProgress(examined, postRows.length)
      await new Promise(r => setTimeout(r, 200))
    }
  }

  return results
}
