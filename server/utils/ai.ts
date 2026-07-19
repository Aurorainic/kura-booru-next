/**
 * AI utilities: OpenAI-compatible API client + tag classification + rating suggestions + admin assistant.
 * Reuses existing env vars: ENABLE_AI_TAG_PROCESSING, AI_PROVIDER_API_KEY, AI_PROVIDER_ENDPOINT, AI_PROVIDER_MODEL.
 * No new npm packages — plain fetch only.
 */

import type { Rating, TagCategory } from '~/types'
import { eq, and, sql, desc, asc, inArray, isNull } from 'drizzle-orm'

// ── Types ──

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TagClassification {
  name: string
  category: TagCategory
  translation: string
  danbooru_name: string
  confidence: number
}

export interface AiJobStatus {
  id: string
  type: 'classify' | 'merges' | 'ratings'
  status: 'running' | 'done' | 'error'
  total: number
  done: number
  errors: string[]
  started_at: number
  result?: any
}

export interface MergeSuggestion {
  canonical_name: string
  aliases: string[]
  reason: string
  confidence: number
}

export interface RatingSuggestion {
  rating: Rating
  confidence: number
  reason: string
}

export interface AssistantSuggestion {
  label: string
  callback_data: string
  action?: { type: string; payload: any }
}

export interface AssistantReply {
  text: string
  suggestions?: AssistantSuggestion[]
}

// ── Config ──

function getAiConfig() {
  const enabled = process.env.ENABLE_AI_TAG_PROCESSING === 'true'
  const apiKey = process.env.AI_PROVIDER_API_KEY
  const endpoint = process.env.AI_PROVIDER_ENDPOINT
  const model = process.env.AI_PROVIDER_MODEL
  return { enabled, apiKey, endpoint, model, configured: !!(apiKey && endpoint && model) }
}

export function isAiEnabled(): boolean {
  const cfg = getAiConfig()
  return cfg.enabled && cfg.configured
}

export function getAiStatus() {
  const cfg = getAiConfig()
  return {
    enabled: cfg.enabled && cfg.configured,
    endpoint: cfg.endpoint ? cfg.endpoint.replace(/\/$/, '') : null,
    model: cfg.model || null,
  }
}

// ── Core API call ──

const AI_TIMEOUT_MS = 30_000
const AI_MAX_RETRIES = 2

function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

async function callAiOnce(messages: AiMessage[], opts?: { json?: boolean; temperature?: number }, signal?: AbortSignal): Promise<string> {
  const cfg = getAiConfig()
  if (!cfg.enabled || !cfg.configured) {
    throw Object.assign(new Error('AI not configured'), { statusCode: 503 })
  }

  const baseEndpoint = cfg.endpoint!.replace(/\/$/, '')
  const url = `${baseEndpoint}/chat/completions`

  const body: Record<string, any> = {
    model: cfg.model,
    messages,
    temperature: opts?.temperature ?? 0.3,
  }
  if (opts?.json) {
    body.response_format = { type: 'json_object' }
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`AI API ${resp.status}: ${text.slice(0, 200)}`)
    Object.assign(err, { statusCode: resp.status, retriable: isRetriableStatus(resp.status) })
    throw err
  }

  const data = await resp.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('AI API returned empty response')
  return content
}

async function callAi(messages: AiMessage[], opts?: { json?: boolean; temperature?: number }): Promise<string> {
  let lastErr: any
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
    try {
      return await callAiOnce(messages, opts, controller.signal)
    } catch (e: any) {
      lastErr = e
      const retriable = e?.retriable || e?.name === 'AbortError' || (e?.code && !e.statusCode)
      if (!retriable || attempt === AI_MAX_RETRIES) throw e
      // Exponential backoff: base 1s * 2^attempt, ±20% jitter
      const base = 1000 * Math.pow(2, attempt)
      const jitter = base * (0.8 + Math.random() * 0.4)
      await new Promise(r => setTimeout(r, jitter))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastErr
}

// ── Tag classification (capability ①) ──

const CLASSIFY_SYSTEM_PROMPT = `You are a booru/anime image tag classifier for a personal anime art gallery (Kura Booru). Tags come from multiple sources (Pixiv, Twitter, Danbooru) and may be in Japanese, English, or romanized form.

Categories:
- artist: The creator/illustrator (e.g. 藤原, redjuice, mika_pikazo)
- character: A specific fictional character (e.g. hatsune_miku, rem_(re:zero), 美樹さやか)
- copyright: A specific franchise/work (e.g. vocaloid, re:zero, genshin_impact, project_sekai)
- general: Visual/descriptive attributes (e.g. long_hair, blue_eyes, school_uniform, 着物)
- meta: Technical/image metadata (e.g. highres, transparent_background, scan, monochrome)

Return JSON: { "tags": [{ "name": "original_tag_name", "category": "artist|character|copyright|general|meta", "translation": "中文翻译", "danbooru_name": "canonical_english_name", "confidence": 0.0_to_1.0 }] }

Rules:
- Preserve the original tag name exactly as given (output "name" must match input)
- For danbooru_name: use the standard Danbooru wiki tag name if you are confident (e.g. "初音ミク" -> "hatsune_miku"). If unsure, leave empty string - do NOT guess
- For translation: provide a concise Chinese translation. For artist names, transliterate (e.g. "redjuice" -> "redjuice", "藤原" -> "藤原"). For general tags, translate the concept (e.g. "long_hair" -> "长发"). Empty string if truly uncertain
- Category assignment priority: if a tag could be either character or copyright, prefer copyright if it names a franchise, character if it names an individual
- confidence: 0.9+ = certain (well-known tag), 0.7-0.9 = fairly confident, 0.5-0.7 = educated guess, <0.5 = uncertain. Use <0.5 sparingly for genuinely ambiguous tags

Examples:
Input: ["hatsune_miku", "初音ミク", "long_hair", "redjuice", "highres"]
Output: { "tags": [
  { "name": "hatsune_miku", "category": "character", "translation": "初音未来", "danbooru_name": "hatsune_miku", "confidence": 0.95 },
  { "name": "初音ミク", "category": "character", "translation": "初音未来", "danbooru_name": "hatsune_miku", "confidence": 0.95 },
  { "name": "long_hair", "category": "general", "translation": "长发", "danbooru_name": "long_hair", "confidence": 0.95 },
  { "name": "redjuice", "category": "artist", "translation": "redjuice", "danbooru_name": "redjuice", "confidence": 0.9 },
  { "name": "highres", "category": "meta", "translation": "高清", "danbooru_name": "highres", "confidence": 0.95 }
]}`

export async function classifyTags(tagNames: string[]): Promise<TagClassification[]> {
  if (!tagNames.length) return []
  // ponytail: batch cap at 25 tags per API call. Long lists (50+) caused
  // degraded quality (skipped tags, hallucinated entries) and increased
  // JSON parse failures. 25 keeps the response compact and reliable.
  const results: TagClassification[] = []
  for (const batch of chunk(tagNames, 25)) {
    const raw = await callAi(
      [
        { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(batch) },
      ],
      { json: true },
    )
    try {
      const parsed = JSON.parse(raw)
      const mapped = (parsed.tags || []).map((t: any) => ({
        name: String(t.name || ''),
        category: validateCategory(t.category),
        translation: String(t.translation || ''),
        danbooru_name: String(t.danbooru_name || ''),
        confidence: clampConfidence(t.confidence, 0.7),
      }))
      // Only keep entries whose name matches one of the input tags
      // (AI sometimes hallucinates extra tags or returns names in a different form)
      const inputSet = new Set(batch)
      results.push(...mapped.filter((c: TagClassification) => inputSet.has(c.name)))
    } catch {
      console.error('[ai] classifyTags: failed to parse AI response for batch')
    }
  }
  return results
}

function clampConfidence(v: any, dflt: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(1, Math.max(0, n))
}

function validateCategory(c: string): TagCategory {
  const valid: TagCategory[] = ['artist', 'character', 'copyright', 'general', 'meta']
  const lower = String(c || '').toLowerCase()
  return valid.includes(lower as TagCategory) ? (lower as TagCategory) : 'general'
}

// ── Tag knowledge cache lookup + AI classify for post tags (pipeline integration) ──

export async function aiProcessTagsForPost(postId: string, tagIds: string[]): Promise<void> {
  if (!isAiEnabled()) return

  // Fetch tag names for the given IDs
  const tagRows = tagIds.length
    ? await db.select().from(tags).where(inArray(tags.id, tagIds))
    : []

  if (!tagRows.length) return

  // ponytail: artist tags are categorized at ingest (pipeline upserts them as category=artist).
  // Skip them here so AI doesn't re-infer and mis-classify.
  const generalTagRows = tagRows.filter(t => t.category !== 'artist')

  // Check tag_knowledge cache first
  const tagNames = generalTagRows.map(t => t.name)
  const cached = await db.select().from(tagKnowledge).where(inArray(tagKnowledge.name, tagNames))
  const cachedMap = new Map(cached.map(c => [c.name, c]))

  const uncached = tagNames.filter(n => !cachedMap.has(n))

  // Classify uncached tags
  let newClassifications: TagClassification[] = []
  if (uncached.length) {
    newClassifications = await classifyTags(uncached)
    if (newClassifications.length) {
      // Bulk upsert cache: single INSERT ... ON CONFLICT covers all rows
      await db.insert(tagKnowledge).values(newClassifications.map(c => ({
        name: c.name,
        danbooruName: c.danbooru_name,
        type: c.category,
        translation: c.translation,
        source: 'ai',
      }))).onConflictDoUpdate({
        target: tagKnowledge.name,
        set: {
          danbooruName: sql`excluded.danbooru_name`,
          type: sql`excluded.type`,
          translation: sql`excluded.translation`,
          source: sql`excluded.source`,
          updatedAt: new Date(),
        },
      })
    }
  }

  // Build merged classification (cached + new)
  const allClassifications = new Map<string, TagClassification>()
  for (const c of cachedMap.values()) {
    allClassifications.set(c.name, {
      name: c.name,
      category: validateCategory(c.type),
      translation: c.translation || '',
      danbooru_name: c.danbooruName || '',
      confidence: 0.7,
    })
  }
  for (const c of newClassifications) {
    allClassifications.set(c.name, c)
  }

  // Update tags table with classification results
  for (const tagRow of generalTagRows) {
    const cls = allClassifications.get(tagRow.name)
    if (!cls) continue
    await db.update(tags).set({
      category: cls.category,
      translation: cls.translation || null,
      danbooruName: cls.danbooru_name || null,
      aiProcessedAt: new Date(),
    }).where(eq(tags.id, tagRow.id))
  }

  // Mark post as AI-processed
  await db.update(posts).set({
    aiTagProcessedAt: new Date(),
    aiTagStatus: 'processed',
  }).where(eq(posts.id, postId))
}

// ── Batch reprocess (Web reprocess endpoint + Bot /aitags) ──

export async function reprocessTags(mode: 'unprocessed' | 'all'): Promise<{ processed: number; failed: number }> {
  const conditions = []
  if (mode === 'unprocessed') conditions.push(isNull(tags.aiProcessedAt))
  // ponytail: never re-classify artist tags — they're categorized at ingest, AI mis-classifies them as general
  conditions.push(sql`${tags.category} != 'artist'`)
  const where = conditions.length ? and(...conditions) : undefined
  const allTags = await db.select().from(tags).where(where)

  let processed = 0
  let failed = 0

  for (const batch of chunk(allTags, 50)) {
    try {
      const classifications = await classifyTags(batch.map(t => t.name))
      if (classifications.length) {
        // Bulk upsert tag_knowledge for the whole batch
        await db.insert(tagKnowledge).values(classifications.map(c => ({
          name: c.name,
          danbooruName: c.danbooru_name,
          type: c.category,
          translation: c.translation,
          source: 'ai',
        }))).onConflictDoUpdate({
          target: tagKnowledge.name,
          set: {
            danbooruName: sql`excluded.danbooru_name`,
            type: sql`excluded.type`,
            translation: sql`excluded.translation`,
            source: sql`excluded.source`,
            updatedAt: new Date(),
          },
        })
        // Bulk update tags for the whole batch via VALUES + UPDATE FROM
        const values = classifications.map(c =>
          sql`(${c.name}::text, ${c.category}::text, ${c.translation || null}::text, ${c.danbooru_name || null}::text)`,
        )
        await db.execute(sql`
          UPDATE tags SET
            category = v.category,
            translation = v.translation,
            danbooru_name = v.danbooru_name,
            ai_processed_at = NOW()
          FROM (VALUES ${sql.join(values, sql`, `)}) AS v(name, category, translation, danbooru_name)
          WHERE tags.name = v.name
        `)
      }
      processed += classifications.length
      failed += Math.max(0, batch.length - classifications.length)
    } catch (e) {
      console.error('[ai] reprocessTags batch failed:', e)
      failed += batch.length
    }
  }

  return { processed, failed }
}

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

// ── Post summary for Bot /info (capability ⑥) ──

export async function generatePostSummary(post: any): Promise<string> {
  const tagNames = (post.tags || []).map((t: any) => t.name).join(', ')
  const translations = (post.tags || []).map((t: any) => t.translation).filter(Boolean).join(', ')

  // ponytail: twitter posts often have no title/description. Without this
  // guard, the AI gets "标题: (无)\n描述: \n标签: " and hallucinates nonsense.
  if (!tagNames && !post.title && !post.description) {
    return '无标题、描述及标签的图片'
  }

  const raw = await callAi([
    {
      role: 'system',
      content: '你是一个动漫图片摘要生成器。根据标题、描述、标签生成一句话中文摘要（不超过80字）。只返回摘要文本，不要加引号或前缀。如果信息不足，返回"信息不足，无法生成摘要"。',
    },
    {
      role: 'user',
      content: `标题: ${post.title || '(无)'}\n描述: ${(post.description || '').slice(0, 200)}\n标签: ${tagNames || '(无)'}\n中文翻译: ${translations || '(无)'}`,
    },
  ], { temperature: 0.5 })
  return raw.trim()
}

// ── Admin assistant chat (capability ④ + ⑧) ──

const ASSISTANT_SYSTEM_PROMPT = `You are an AI assistant for a booru-style anime image gallery management system (Kura Booru). You help the admin manage tags, posts, and ratings.

You have access to the following real-time database statistics, which are provided in the context section of each user message:
- Total posts, total tags, unprocessed tags, tags missing translation, posts pending AI processing, safe-rated posts percentage

Available actions you can suggest (as clickable buttons):
- "分类未处理标签" — Classify unprocessed tags into categories with Chinese translations
- "扫描合并建议" — Find tags that should be merged
- "扫描评级建议" — Review post ratings for accuracy

When the admin asks a question:
1. Answer in Chinese (the admin interface is in Chinese)
2. Use the database statistics in the context to answer factual questions about the gallery state
3. If the admin asks about something the context doesn't cover (e.g. "how many explicit posts?"), be honest that you only have aggregate counts and suggest they check the admin panel
4. If the admin's question implies an action, suggest the relevant action button
5. Keep responses concise and practical

Return JSON: { "text": "your Chinese response", "suggestions": [{ "label": "按钮文字", "callback_data": "natural language query to send back" }] }

Important:
- callback_data should be a short natural-language query that, when sent back to you, will trigger the action (e.g. "分类未处理的标签" or "扫描合并建议")
- suggestions is optional - only include when the admin might want to take an action
- Do NOT claim you can query individual tags or posts - you only have aggregate statistics`

export async function adminAssistantChat(
  query: string,
  context: { source: 'web' | 'bot'; lang?: string; history?: AiMessage[] },
): Promise<AssistantReply> {
  // Gather DB context for the query
  const dbContext = await gatherAssistantContext(query)

  const messages: AiMessage[] = [
    { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
  ]

  if (context.history?.length) {
    messages.push(...context.history)
  }

  messages.push({
    role: 'user',
    content: `Context: ${dbContext}\n\nQuestion: ${query}\nSource: ${context.source}\nLanguage: ${context.lang || 'zh'}`,
  })

  const raw = await callAi(messages, { json: true, temperature: 0.4 })

  try {
    const parsed = JSON.parse(raw)
    return {
      text: String(parsed.text || ''),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 8) : undefined,
    }
  } catch {
    // Fallback: treat raw as plain text
    return { text: raw.slice(0, 2000) }
  }
}

async function gatherAssistantContext(query: string): Promise<string> {
  const parts: string[] = []

  try {
    const [postCount, tagCount, unprocessedCount, missingTranslationCount, pendingPostCount, safeCount, qCount, eCount, charCount, artistCount, copyrightCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(posts),
      db.select({ count: sql<number>`count(*)` }).from(tags),
      db.select({ count: sql<number>`count(*)` }).from(tags).where(isNull(tags.aiProcessedAt)),
      db.select({ count: sql<number>`count(*)` }).from(tags).where(sql`${tags.translation} IS NULL OR ${tags.translation} = ''`),
      db.select({ count: sql<number>`count(*)` }).from(posts).where(isNull(posts.aiTagStatus)),
      db.select({ count: sql<number>`count(*)` }).from(posts).where(eq(posts.rating, 'safe')),
      db.select({ count: sql<number>`count(*)` }).from(posts).where(eq(posts.rating, 'questionable')),
      db.select({ count: sql<number>`count(*)` }).from(posts).where(eq(posts.rating, 'explicit')),
      db.select({ count: sql<number>`count(*)` }).from(tags).where(eq(tags.category, 'character')),
      db.select({ count: sql<number>`count(*)` }).from(tags).where(eq(tags.category, 'artist')),
      db.select({ count: sql<number>`count(*)` }).from(tags).where(eq(tags.category, 'copyright')),
    ])

    const totalPosts = Number(postCount[0]?.count || 0)
    const safeNum = Number(safeCount[0]?.count || 0)
    const safePct = totalPosts ? Math.round((safeNum / totalPosts) * 100) : 0

    // ponytail: query-aware context. The previous version always returned the
    // same 6 counts regardless of what the admin asked - if they asked "how
    // many explicit posts?", the context didn't include that number, so the
    // AI had to guess or deflect. Now we always provide the full breakdown so
    // the AI can answer any stats question from context.
    parts.push(`Database statistics:`)
    parts.push(`- Total posts: ${totalPosts} (safe: ${safeNum} (${safePct}%), questionable: ${Number(qCount[0]?.count || 0)}, explicit: ${Number(eCount[0]?.count || 0)})`)
    parts.push(`- Total tags: ${Number(tagCount[0]?.count || 0)} (artist: ${Number(artistCount[0]?.count || 0)}, character: ${Number(charCount[0]?.count || 0)}, copyright: ${Number(copyrightCount[0]?.count || 0)})`)
    parts.push(`- Unprocessed tags (no AI classification): ${Number(unprocessedCount[0]?.count || 0)}`)
    parts.push(`- Tags missing Chinese translation: ${Number(missingTranslationCount[0]?.count || 0)}`)
    parts.push(`- Posts pending AI tag processing: ${Number(pendingPostCount[0]?.count || 0)}`)
  } catch { /* ignore */ }

  return parts.join('\n')
}

// ── Utility ──

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

// ── AI job progress (Redis-backed, short TTL) ──
// ponytail: avoid new PG tables for transient progress state; Redis SETEX with
// 1800s TTL auto-cleans. On completion, set status=done and shrink TTL to 60s.

const AI_JOB_TTL_RUNNING = 1800  // 30 min while running
const AI_JOB_TTL_DONE = 60       // 1 min after completion (lets polls settle)
const AI_JOB_KEY = (id: string) => `kura:ai_job:${id}`

export async function createAiJob(type: AiJobStatus['type'], total: number): Promise<string> {
  const id = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const status: AiJobStatus = {
    id, type, status: 'running', total, done: 0, errors: [], started_at: Date.now(),
  }
  await redis.set(AI_JOB_KEY(id), JSON.stringify(status), { EX: AI_JOB_TTL_RUNNING })
  return id
}

export async function updateAiJobProgress(id: string, patch: Partial<Pick<AiJobStatus, 'done' | 'errors' | 'total'>>): Promise<void> {
  try {
    const raw = await redis.get(AI_JOB_KEY(id))
    if (!raw) return  // expired or missing — silent
    const s = JSON.parse(raw) as AiJobStatus
    if (patch.done !== undefined) s.done = patch.done
    if (patch.total !== undefined) s.total = patch.total
    if (patch.errors) s.errors = [...s.errors, ...patch.errors].slice(-50)
    await redis.set(AI_JOB_KEY(id), JSON.stringify(s), { EX: AI_JOB_TTL_RUNNING })
  } catch (e) { console.error('[ai] updateAiJobProgress failed:', e) }
}

export async function completeAiJob(id: string, result: any, hadErrors: boolean): Promise<void> {
  try {
    const raw = await redis.get(AI_JOB_KEY(id))
    const s: AiJobStatus = raw ? JSON.parse(raw) : {
      id, type: 'classify', status: 'done', total: 0, done: 0, errors: [], started_at: Date.now(),
    }
    s.status = hadErrors ? 'error' : 'done'
    s.result = result
    await redis.set(AI_JOB_KEY(id), JSON.stringify(s), { EX: AI_JOB_TTL_DONE })
  } catch (e) { console.error('[ai] completeAiJob failed:', e) }
}

export async function getAiJobStatus(id: string): Promise<AiJobStatus | null> {
  try {
    const raw = await redis.get(AI_JOB_KEY(id))
    if (!raw) return null
    return JSON.parse(raw) as AiJobStatus
  } catch { return null }
}
