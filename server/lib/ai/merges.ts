// v0.9.0 R2.5: split from server/utils/ai.ts. Merge suggestions (capability ②).

import { eq, and, sql, desc, asc } from 'drizzle-orm'
import { db } from '../../utils/db'
import { tags } from '../../schema'
import type { TagCategory } from '../../platform/schemas/enums'
import { callAi, extractJsonFromRaw } from './client'
import { chunk } from './utility'
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

  const inputNames = new Set(tagRows.map(t => t.name))
  const tagInfo = tagRows.map(t => `${t.name} (${t.category}, count:${t.postCount}${t.translation ? `, zh:${t.translation}` : ''})`)

  const systemPrompt = `你是 booru 图库的标签体系分析器。给定一批标签，识别指向同一概念、应被合并的分组。重点考虑: 拼写变体、翻译差异、缩写形式、角色名变体。

规则：
1. 只允许合并【同一分类】内的标签（两个 character 可合并，但 character 绝不与 artist 合并，即使名字相似）
2. 只给出你确认的分组（confidence >= 0.6）
3. canonical_name 应是该组中最标准的形式（优先选 post_count 高、罗马音规范的标签）
4. canonical_name 与 aliases 必须都来自输入列表中的标签名，禁止编造输入中不存在的名字
5. 无需合并时返回 { "groups": [] }

只返回 JSON，不要解释。格式: { "groups": [{ "canonical_name": "最佳标签名", "aliases": ["变体1", "变体2"], "reason": "简洁中文理由", "confidence": 0.0到1.0 }] }`

  // H18: 200 标签元数据 ≈ 4-8k tokens 会截断小模型 — 按 50 分块，每块独立
  // 调用 AI，合并结果（去重）。输出结构与单次调用完全一致。
  const rawGroups: any[] = []
  for (const batch of chunk(tagInfo, 50)) {
    try {
      const raw = await callAi([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: batch.join('\n') },
      ], { json: true })
      const parsed = extractJsonFromRaw(raw) as { groups?: any[] }
      if (parsed?.groups) rawGroups.push(...parsed.groups)
    } catch (e) {
      console.error('[ai] suggestMerges batch failed:', e)
      // 单批失败不影响其它批次
    }
  }

  try {
    // ponytail: 过滤掉引用不存在标签的分组——AI 可能建议合并输入列表之外的
    // "标签"，这些在 DB 里没有对应行，前端执行合并会失败。
    const seen = new Set<string>()
    return rawGroups
      .filter((g: any) => (g.confidence || 0) >= 0.6)
      .map((g: any) => ({
        canonical_name: String(g.canonical_name || ''),
        aliases: Array.isArray(g.aliases) ? g.aliases.map((a: any) => String(a)).filter((a: string) => a && a !== g.canonical_name) : [],
        reason: String(g.reason || ''),
        confidence: Number(g.confidence) || 0,
      }))
      .filter((g: MergeSuggestion) =>
        inputNames.has(g.canonical_name) &&
        g.aliases.length > 0 &&
        g.aliases.every(a => inputNames.has(a)),
      )
      .filter((g: MergeSuggestion) => {
        // 跨批去重：同一 canonical 只保留首个（批间可能重复建议）
        const key = `${g.canonical_name}:${[...g.aliases].sort().join('|')}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  } catch {
    console.error('[ai] suggestMerges: failed to parse AI response')
    return []
  }
}
