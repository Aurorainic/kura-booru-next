// v0.9.0 R2.5: split from server/utils/ai.ts. Tag classification (capability ①).

import type { TagCategory } from '../../platform/schemas/enums'
import { callAi, extractJsonFromRaw } from './client'
import { chunk } from './utility'
import { getTagKnowledge, sampleKnowledgeExamples } from './tag-cache'
import type { TagClassification } from './types'

// ── Tag classification (capability ①) ──

// ponytail: prompt 用中文写（输出面向中文用户），并显式约束：必须为每个输入
// 标签都输出一条（防止模型漏标签）、translation 必须简洁中文。danbooru_name
// 仅限确认时填，避免幻觉。
const CLASSIFY_SYSTEM_PROMPT = `你是 booru 风格动漫图库（Kura Booru）的标签分类器。输入标签来自 Pixiv、Twitter、Danbooru 等，可能是日文、英文或罗马音。

分类规则：
- artist: 画师/创作者（例: 藤原, redjuice, mika_pikazo）
- character: 具体虚构角色（例: hatsune_miku, rem_(re:zero), 美樹さやか）
- copyright: 具体作品/系列（例: vocaloid, re:zero, genshin_impact, project_sekai）
- general: 视觉/描述性属性（例: long_hair, blue_eyes, school_uniform, 着物）
- meta: 技术/图片元数据（例: highres, transparent_background, scan, monochrome）

必须遵守：
1. 为输入的【每一个】标签都输出一条结果，禁止遗漏、禁止凭空新增输入中没有的标签
2. "name" 必须原样保留输入标签名，不得改写大小写或格式
3. "translation": 给简洁中文翻译；画师名保留原名（例: redjuice → redjuice）；通用标签翻译概念（long_hair → 长发）；确实无法翻译才留空
4. "danbooru_name": 只有当你确认存在标准 Danbooru wiki 标签名时才填（初音ミク → hatsune_miku），不确定一律留空字符串，绝不猜
5. 分类优先级: 若同时像 character 与 copyright，指代作品/系列选 copyright，指代个体角色选 character
6. "confidence": 0.9+ 确定；0.7-0.9 较有把握；0.5-0.7 推测；<0.5 不确定（仅限真正模糊的标签，少用）
7. 优先参考下方"本图库已确认的分类样例"，与你判断一致时保持一致性；不一致时以你的判断为准并给出高置信度理由

只返回 JSON，不要任何解释文字。格式: { "tags": [{ "name": "原标签名", "category": "artist|character|copyright|general|meta", "translation": "中文翻译", "danbooru_name": "canonical_english_name 或空串", "confidence": 0.0到1.0 }] }`

/**
 * 动态构建 few-shot 样例段（agent 记忆锚点）。
 * 从 tag_knowledge 采样本图库已确认的分类，注入 prompt 让模型在既有决策
 * 基础上延续，减少分类漂移、稳固角色定位。采样失败时优雅降级（无样例段）。
 */
async function buildKnowledgeExamplesPrompt(): Promise<string> {
  const examples = await sampleKnowledgeExamples(3, 15)
  if (!examples.length) return ''
  const lines = examples.map(e =>
    `  { "name": "${e.name}", "category": "${e.category}", "translation": "${e.translation}", "danbooru_name": "${e.danbooru_name}", "confidence": ${e.confidence} }${e._source === 'manual' ? '  ←人工确认' : ''}`,
  )
  return `\n本图库已确认的分类样例（可参考保持一致）:\n${lines.join('\n')}\n`
}

export async function classifyTags(tagNames: string[]): Promise<TagClassification[]> {
  if (!tagNames.length) return []
  // ponytail: 入参去重（同一批里可能混入重复名），避免重复打标签浪费 token。
  const unique = [...new Set(tagNames.map(n => n.trim()).filter(Boolean))]
  if (!unique.length) return []

  // agent 记忆优先：命中 tag_knowledge 的标签直接采用缓存结果（不浪费 AI 调用）。
  // 尤其人工纠偏（manual）是硬约束——管理员改过的分类永远优先，避免模型翻案。
  const cached = await getTagKnowledge(unique)
  const results: TagClassification[] = []
  const uncachedNames: string[] = []
  for (const n of unique) {
    const c = cached.get(n)
    if (c) results.push(c)
    else uncachedNames.push(n)
  }
  if (!uncachedNames.length) return results

  const examplesPrompt = await buildKnowledgeExamplesPrompt()

  // ponytail: batch cap at 25 tags per API call. Long lists (50+) caused
  // degraded quality (skipped tags, hallucinated entries) and increased
  // JSON parse failures. 25 keeps the response compact and reliable.
  const inputSet = new Set(uncachedNames)
  for (const batch of chunk(uncachedNames, 25)) {
    const raw = await callAi(
      [
        { role: 'system', content: CLASSIFY_SYSTEM_PROMPT + examplesPrompt },
        { role: 'user', content: JSON.stringify(batch) },
      ],
      { json: true, temperature: 0.1 },
    )
    try {
      const parsed = extractJsonFromRaw(raw) as { tags?: any[] }
      const mapped = (parsed.tags || []).map((t: any) => ({
        name: String(t.name || ''),
        category: validateCategory(t.category),
        translation: String(t.translation || ''),
        danbooru_name: String(t.danbooru_name || ''),
        confidence: clampConfidence(t.confidence, 0.7),
      }))
      // Only keep entries whose name matches one of the input tags
      // (AI sometimes hallucinates extra tags or returns names in a different form)
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
