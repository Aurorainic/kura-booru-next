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

  // ponytail: 复用 tag_knowledge 缓存——未处理模式第二次运行时，已缓存的标签
  // 直接命中，不再重复打 AI（与 aiProcessTagsForPost 行为一致），并照常落库
  // 标记 ai_processed_at，避免反复被计为"待处理"。
  const names = allTags.map(t => t.name)
  const cached = await getTagKnowledge(names)
  const results = new Map<string, TagClassification>(cached)

  const pendingRows = allTags.filter(t => !cached.has(t.name))
  for (const batch of chunk(pendingRows, 50)) {
    try {
      const batchNames = batch.map(t => t.name)
      const classifications = await classifyTags(batchNames)
      if (classifications.length) {
        await upsertTagKnowledge(classifications)
        for (const c of classifications) results.set(c.name, c)
      }
    } catch (e) {
      console.error('[ai] reprocessTags batch failed:', e)
    }
  }

  // 统一落库：缓存命中 + AI 新分类，一次性 VALUES + UPDATE FROM
  const updates: { name: string; category: string; translation: string | null; danbooru_name: string | null }[] = []
  for (const t of allTags) {
    const c = results.get(t.name)
    if (c) updates.push({ name: t.name, category: c.category, translation: c.translation || null, danbooru_name: c.danbooru_name || null })
  }
  if (updates.length) {
    const values = updates.map(c =>
      sql`(${c.name}::text, ${c.category}::text, ${c.translation}::text, ${c.danbooru_name}::text)`,
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

  // agent 自学习闭环 —— 知识库↔标签表 双向对齐：
  //   (a) 人工纠偏（source='manual'）是最高权威：tags 以 knowledge 为准
  //       （管理员在后台改过分类/翻译，必须回写 tags，否则展示与记忆漂移）。
  //   (b) AI 分类（source='ai'）仅当 tags 尚未处理时才回写（避免覆盖人工结果）。
  //   这样 knowledge 成为"共享记忆"，tags 成为"当前事实"，两者持续收敛。
  try {
    const manualRows = await db.select()
      .from(tagKnowledge)
      .where(eq(tagKnowledge.source, 'manual'))
    if (manualRows.length) {
      const mValues = manualRows.map(k =>
        sql`(${k.name}::text, ${k.type}::text, ${k.translation}::text, ${k.danbooruName}::text)`,
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

  const processed = updates.length
  const failed = allTags.length - updates.length
  return { processed, failed }
}
