// v0.9.0 R2.5: split from server/utils/ai.ts. Pipeline integration + batch reprocess.

import { eq, and, sql, inArray, isNull } from 'drizzle-orm'
import { db } from '../../utils/db'
import { tags, tagKnowledge, posts } from '../../schema'
import { isAiEnabled } from './config'
import { classifyTags } from './classify'
import { getTagKnowledge, upsertTagKnowledge } from './tag-cache'
import { chunk } from './utility'
import type { TagClassification } from './types'

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
  const tagNames = generalTagRows.map(t => t.name)

  // Check tag_knowledge cache first, classify only the uncached ones
  const cached = await getTagKnowledge(tagNames)
  const uncached = tagNames.filter(n => !cached.has(n))

  let newClassifications: TagClassification[] = []
  if (uncached.length) {
    newClassifications = await classifyTags(uncached)
    if (newClassifications.length) await upsertTagKnowledge(newClassifications)
  }

  // Build merged classification (cached + new)
  const allClassifications = new Map<string, TagClassification>(cached)
  for (const c of newClassifications) {
    allClassifications.set(c.name, c)
  }

  // H11: 批量更新 tags — 100 标签 = 1 次 VALUES UPDATE（原实现 100 次单行往返）。
  // 与 reprocessTags 的 syncResultsToTags 同一模式（含 tag_category_enum cast）。
  const pendingUpdates: Array<{ name: string; category: TagClassification['category']; translation: string | null; danbooru_name: string | null }> = []
  for (const tagRow of generalTagRows) {
    const cls = allClassifications.get(tagRow.name)
    if (!cls) continue
    pendingUpdates.push({
      name: tagRow.name,
      category: cls.category,
      translation: cls.translation || null,
      danbooru_name: cls.danbooru_name || null,
    })
  }

  if (pendingUpdates.length) {
    const values = pendingUpdates.map(c =>
      sql`(${c.name}::text, ${c.category}::tag_category_enum, ${c.translation}::text, ${c.danbooru_name}::text)`,
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

  // ponytail: 复用 tag_knowledge 缓存——未处理模式第二次运行时，已缓存的标签
  // 直接命中，不再重复打 AI（与 aiProcessTagsForPost 行为一致），并照常落库
  // 标记 ai_processed_at，避免反复被计为"待处理"。
  const names = allTags.map(t => t.name)
  const cached = await getTagKnowledge(names)
  const results = new Map<string, TagClassification>(cached)

  // 每处理一批就把该批结果同步到 tags 表（不再等全部批次结束才一次性更新）。
  // ponytail: 之前末尾统一 UPDATE——若中途某批抛异常中断整个函数，knowledge 已
  // 写但 tags 未同步，造成记忆与事实漂移（且 500 丢失整批结果）。
  let processed = 0
  let failed = 0

  async function syncResultsToTags() {
    const updates: { name: string; category: string; translation: string | null; danbooru_name: string | null }[] = []
    for (const t of allTags) {
      if (t.aiProcessedAt) continue  // 已处理过的不重复更新
      const c = results.get(t.name)
      if (c) updates.push({ name: t.name, category: c.category, translation: c.translation || null, danbooru_name: c.danbooru_name || null })
    }
    if (!updates.length) return
    const values = updates.map(c =>
      sql`(${c.name}::text, ${c.category}::tag_category_enum, ${c.translation}::text, ${c.danbooru_name}::text)`,
    )
    await db.execute(sql`
      UPDATE tags SET
        category = v.category,
        translation = v.translation,
        danbooru_name = v.danbooru_name,
        ai_processed_at = NOW()
      FROM (VALUES ${sql.join(values, sql`, `)}) AS v(name, category, translation, danbooru_name)
      WHERE tags.name = v.name AND tags.ai_processed_at IS NULL AND tags.category != 'artist'
    `)
  }

  // 缓存命中的先同步（避免缓存有但 tags 未标记）
  await syncResultsToTags().catch(e => console.error('[ai] reprocessTags sync cached failed:', e))

  const pendingRows = allTags.filter(t => !cached.has(t.name))
  for (const batch of chunk(pendingRows, 50)) {
    try {
      const batchNames = batch.map(t => t.name)
      // ponytail: classifyTags 内部已按 25 分片 + 60s 超时兜底；这里每 50 一批
      const classifications = await classifyTags(batchNames)
      if (classifications.length) {
        await upsertTagKnowledge(classifications)
        for (const c of classifications) results.set(c.name, c)
        await syncResultsToTags()
      }
      processed += classifications.length
      failed += Math.max(0, batch.length - classifications.length)
    } catch (e) {
      console.error('[ai] reprocessTags batch failed:', e)
      // 单个批次失败不影响整体——分类失败的标签计为失败，不中断后续
      failed += batch.length
    }
  }

  // agent 自学习闭环 —— 人工纠偏（source='manual'）是最高权威：tags 以 knowledge 为准
  try {
    const manualRows = await db.select()
      .from(tagKnowledge)
      .where(eq(tagKnowledge.source, 'manual'))
    if (manualRows.length) {
      const mValues = manualRows.map(k =>
        sql`(${k.name}::text, ${k.type}::tag_category_enum, ${k.translation}::text, ${k.danbooruName}::text)`,
      )
      await db.execute(sql`
        UPDATE tags SET
          category = v.category,
          translation = v.translation,
          danbooru_name = v.danbooru_name,
          ai_processed_at = NOW()
        FROM (VALUES ${sql.join(mValues, sql`, `)}) AS v(name, category, translation, danbooru_name)
        WHERE tags.name = v.name
      `)
    }
  } catch (e) {
    console.error('[ai] reprocessTags manual alignment failed:', e)
  }

  return { processed, failed }
}
