// v0.9.0 R2.5: split from server/utils/ai.ts. Tag classification (capability ①).

import type { TagCategory } from '~/types'
import { callAi } from './client'
import { chunk } from './utility'
import type { TagClassification } from './types'

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

export function validateCategory(c: string): TagCategory {
  const valid: TagCategory[] = ['artist', 'character', 'copyright', 'general', 'meta']
  const lower = String(c || '').toLowerCase()
  return valid.includes(lower as TagCategory) ? (lower as TagCategory) : 'general'
}
