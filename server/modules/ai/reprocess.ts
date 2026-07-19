// v0.9.0 R2.5: split from server/utils/ai.ts. Pipeline integration + batch reprocess.

import { eq, and, sql, inArray, isNull } from 'drizzle-orm'
import { db } from '../../utils/db'
import { tags, tagKnowledge, posts } from '../../schema'
import { isAiEnabled } from './config'
import { classifyTags, validateCategory } from './classify'
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
