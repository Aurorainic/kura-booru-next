// v0.9.0 R2.5: split from server/utils/ai.ts. Rating suggestions (capability ③ + Bot capability ⑤).

import { eq, and, desc } from 'drizzle-orm'
import { db } from '../../utils/db'
import { posts, postTags, tags } from '../../schema'
import type { Rating } from '../../platform/schemas/enums'
import { callAi, extractJsonFromRaw } from './client'
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
    // 明确裸露/性行为
    'nude', 'naked', 'topless', 'bottomless', 'nipples', 'areola', 'breasts',
    'penis', 'vagina', 'cum', 'sex', 'masturbation', 'oral', 'penetration',
    'nudity', 'explicit', 'hentai', 'futanari', 'tentacles', 'bondage',
    'nude_filter', 'nude_girl', 'nude_body',
    // 内衣/暴露衣著
    'panties', 'bra', 'underwear', 'lingerie', 'pantyhose', 'thighhighs',
    'panty_shot', 'underboob', 'sideboob', 'cleavage', 'cameltoe', 'ass',
    'butt', 'bikini', 'swimsuit',
    // 日文/罗马音
    'エロ', 'えっち', '裸', 'パンツ', '下着', 'おっぱい', 'ふたなり',
    'ecchi', 'roulai', '18+', 'r18',
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
      content: `你是 booru 风格动漫图库（Kura Booru）的内容分级器。你只能根据标签、标题、描述与图片尺寸判断，无法看到图片本身。

分级（booru 惯例）：
- safe: 全年龄内容。角色衣着完整、无暗示元素、无暴露衣物。轻微福利（如胖次走光）即不符合 safe。
- questionable: 暗示性或轻度成人内容。包括: ecchi、泳装、内衣、暗示性姿势、胖次走光、可见内衣、挑逗性服装、非直白的福利。
- explicit: 明确成人/NSFW 内容。包括: 裸露、性行为、可见性器官、hentai。

判定规则：
1. 标记 [STRONG] 的标签是强信号，需重点加权。
2. 若多个 [STRONG] 标签指向成人内容但无法确定是否 explicit，取 questionable 而非 explicit。
3. 若没有任何 [STRONG] 标签，极大概率是 safe——只有标题/描述明确指向成人内容才上调。
4. 日文标题/描述里的成人暗示词（えっち、エロ、裸、Hなど）也是信号。
5. 长窄比例（竖版）更可能是漫画/同人页（explicit 概率略高），宽幅更可能是普通插画——仅作弱信号。

只返回 JSON，不要解释。格式: { "rating": "safe|questionable|explicit", "confidence": 0.0到1.0, "reason": "简洁中文理由，引用具体标签" }`,
    },
    {
      role: 'user',
      content: `标题: ${post.title || '(无)'}\n描述: ${(post.description || '').slice(0, 300)}\n来源: ${post.sourceSite}\n图片: ${post.width}x${post.height} (${orientation}, ratio ${aspectRatio})\n标签: ${tagInfo.join(', ')}`,
    },
  ], { json: true })

  try {
    const parsed = extractJsonFromRaw(raw) as { rating?: string; confidence?: number; reason?: string }
    const validRatings: Rating[] = ['safe', 'questionable', 'explicit']
    const rating = validRatings.includes(parsed.rating as Rating) ? parsed.rating as Rating : 'safe'
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
