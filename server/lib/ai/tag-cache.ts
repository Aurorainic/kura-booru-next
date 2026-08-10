// v0.10.0: tag_knowledge 缓存读写封装（classify 结果缓存），pipeline 与批量重处理共用。

import { eq, and, inArray, sql, desc } from 'drizzle-orm'
import { db } from '../../utils/db'
import { tagKnowledge } from '../../schema'
import { validateCategory } from './classify'
import type { TagClassification } from './types'

export interface TagKnowledgeEntry {
  name: string
  danbooruName: string | null
  type: string
  translation: string | null
  source: string
}

/** source 优先级：manual（人工纠偏）> ai（AI 分类）。低优先级不覆盖高优先级。 */
const SOURCE_RANK: Record<string, number> = { manual: 3, ai: 2 }

function mergeByRank(current: TagClassification | undefined, incoming: TagClassification): TagClassification {
  if (!current) return incoming
  const curRank = SOURCE_RANK[current._source || ''] ?? 1
  const newRank = SOURCE_RANK[incoming._source || ''] ?? 1
  return newRank >= curRank ? incoming : current
}

/** 批量读取缓存：返回 name → 分类结果（按 source 优先级取最高）。 */
export async function getTagKnowledge(names: string[]): Promise<Map<string, TagClassification>> {
  const unique = [...new Set(names.map(n => n.trim()).filter(Boolean))]
  if (!unique.length) return new Map()
  const rows = await db.select().from(tagKnowledge).where(inArray(tagKnowledge.name, unique))
  const out = new Map<string, TagClassification>()
  for (const r of rows) {
    const entry: TagClassification = {
      name: r.name,
      category: validateCategory(r.type),
      translation: r.translation || '',
      danbooru_name: r.danbooruName || '',
      confidence: 0.7,
      _source: r.source,
    }
    const merged = mergeByRank(out.get(r.name), entry)
    if (merged) out.set(r.name, merged)
  }
  return out
}

/**
 * 从经验库采样 few-shot 样本作为 AI 分类「记忆锚点」：参考历史确认过的分类
 * （优先 manual 人工纠偏），覆盖多个分类且限制总量，避免 prompt 过长。
 */
export async function sampleKnowledgeExamples(perCategory = 3, maxTotal = 15): Promise<TagClassification[]> {
  try {
    const rows = await db.select().from(tagKnowledge)
      .orderBy(desc(tagKnowledge.updatedAt))
      .limit(200)
    // 只取有完整信息的条目（有翻译或 danbooru_name，说明是有效分类）
    const useful = rows.filter(r => r.translation || r.danbooruName)
    const byCat = new Map<string, TagClassification[]>()
    for (const r of useful) {
      const cat = validateCategory(r.type)
      const arr = byCat.get(cat) || []
      arr.push({
        name: r.name,
        category: cat,
        translation: r.translation || '',
        danbooru_name: r.danbooruName || '',
        confidence: 0.8,
        _source: r.source,
      })
      byCat.set(cat, arr)
    }
    const examples: TagClassification[] = []
    const categories = ['artist', 'character', 'copyright', 'general', 'meta'] as const
    for (const cat of categories) {
      const arr = byCat.get(cat) || []
      // manual 优先
      const ranked = [...arr].sort((a, b) => (SOURCE_RANK[b._source || ''] ?? 1) - (SOURCE_RANK[a._source || ''] ?? 1))
      for (const e of ranked.slice(0, perCategory)) {
        if (examples.length >= maxTotal) return examples
        examples.push(e)
      }
    }
    return examples
  } catch (e) {
    console.warn('[ai] sampleKnowledgeExamples failed (non-fatal):', e)
    return []
  }
}

/**
 * 批量 upsert 缓存（单条 INSERT ... ON CONFLICT，覆盖既有行）。
 */
export async function upsertTagKnowledge(classifications: TagClassification[]): Promise<void> {
  const good = classifications.filter(c => c._source === 'manual' || c.confidence >= 0.6)
  if (!good.length) return
  await db.insert(tagKnowledge).values(good.map(c => ({
    name: c.name,
    danbooruName: c.danbooru_name,
    type: c.category,
    translation: c.translation,
    source: c._source || 'ai',
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

/** 按名称批量删除经验库条目（用于合并/清理后的残留）。 */
export async function deleteTagKnowledge(names: string[]): Promise<void> {
  const unique = [...new Set(names)].filter(Boolean)
  if (!unique.length) return
  await db.delete(tagKnowledge).where(inArray(tagKnowledge.name, unique))
}
