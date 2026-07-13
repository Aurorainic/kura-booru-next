/**
 * Pipeline consumer: processes sidecar results → creates Posts, thumbnails, S3 uploads.
 *
 * Consumed by 01-pipeline-worker.ts Nitro plugin. Each result flows through:
 *   decode → dedup → thumbnails → S3 → DB insert → tags → auto-rating → notify
 */

import crypto from 'crypto'
import { db } from './db'
import { posts, tags, postTags, autoRatingRules } from '../schema'
import { eq, sql, inArray } from 'drizzle-orm'
import { uploadToS3 } from './s3'
import { findDuplicateByPhash } from './phash'
import type { SidecarResult, PipelineResult } from './queue'

// ── Sharp lazy load ──
let _sharp: any = null
async function getSharp() {
  if (!_sharp) {
    try { _sharp = await import('sharp') }
    catch { console.error('[pipeline] sharp not installed — thumbnails disabled'); return null }
  }
  return _sharp
}

// ── Rating rank for "only upgrade" logic ──
const RATING_RANK: Record<string, number> = { safe: 0, questionable: 1, explicit: 2 }

// PipelineResult is now re-exported from queue.ts — use that single source of truth

export async function processResult(result: SidecarResult): Promise<PipelineResult> {
  if (result.status === 'error') {
    return { status: 'failed', error: result.error || 'Unknown error' }
  }

  if (!result.image_bytes_b64 || !result.metadata) {
    return { status: 'failed', error: 'No image data or metadata in result' }
  }

  const imageBuffer = Buffer.from(result.image_bytes_b64, 'base64')
  const meta = result.metadata

  // ── MAX_IMAGE_SIZE check ──
  const maxSize = parseInt(process.env.MAX_IMAGE_SIZE || '0', 10)
  if (maxSize > 0 && imageBuffer.length > maxSize) {
    return { status: 'too_large', source_site: meta.source_site, source_id: meta.source_id }
  }

  // Validate source site against enum
  const VALID_SOURCES = new Set(['pixiv', 'twitter', 'danbooru', 'other'])
  const sourceSite = VALID_SOURCES.has(meta.source_site) ? meta.source_site as any : 'other' as any

  try {
    // ── 1. phash dedup ──
    if (result.phash && /^[0-9a-f]+$/i.test(result.phash) && result.phash.length >= 4) {
      const prefix = result.phash.slice(0, 4)
      const candidates = await db
        .select({ id: posts.id, phash: posts.phash })
        .from(posts)
        .where(sql`left(${posts.phash}, 4) = ${prefix}`)

      const dupId = findDuplicateByPhash(
        candidates as { id: string; phash: string }[],
        result.phash,
      )
      if (dupId) {
        return { status: 'duplicate', existing_post_id: dupId, source_site: meta.source_site, source_id: meta.source_id }
      }
    }

    // ── 2. Generate thumbnails (sharp) + probe metadata ──
    // sharp owns all raster image processing now — thumb/preview/LQIP.
    // Sidecar keeps gallery-dl download + phash + raw dims/mime: phash needs
    // imagehash's exact DCT, and migrating it to sharp breaks cross-era dedup
    // (different Lanczos impls → ~6–14 bit Hamming drift on the same image,
    // at/above the dedup threshold of 8). Sharp re-derives dims/mime from the
    // uploaded bytes so they always match what we actually store.
    const sharpMod = await getSharp()
    let thumbBuffer: Buffer | null = null
    let previewBuffer: Buffer | null = null
    let lqipDataUri: string | null = null
    let width = meta.width
    let height = meta.height
    let mimeType = meta.mime_type

    if (sharpMod) {
      const img = sharpMod.default(imageBuffer)
      ;[thumbBuffer, previewBuffer] = await Promise.all([
        img.clone().resize(300, 300, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(),
        img.clone().resize(1280, undefined, { fit: 'inside' }).webp({ quality: 85 }).toBuffer(),
      ])
      // LQIP: 20×20 webp blur → base64 data URI (embedded in API response, no extra request)
      const lqipBuf = await img.clone()
        .resize(20, 20, { fit: 'cover' })
        .blur(2)
        .webp({ quality: 40 })
        .toBuffer()
      lqipDataUri = `data:image/webp;base64,${lqipBuf.toString('base64')}`

      // Re-derive dims/mime from the actual image bytes — sidecar's values
      // come from Pillow on the downloaded file, sharp sees the same bytes so
      // they agree; sharp wins on conflict (it's the bytes we upload).
      const probed = await img.metadata()
      if (probed.width && probed.height) { width = probed.width; height = probed.height }
      if (probed.format) mimeType = `image/${probed.format === 'jpeg' ? 'jpeg' : probed.format}`
    }

    // ── 3. Upload to S3 ──
    const ext = mimeType?.split('/')[1] || 'png'
    const imageKey = `${crypto.randomUUID()}.${ext}`
    const thumbKey = thumbBuffer ? `${crypto.randomUUID()}.webp` : ''
    const previewKey = previewBuffer ? `${crypto.randomUUID()}.webp` : ''

    await Promise.all([
      uploadToS3(imageKey, imageBuffer, mimeType || 'image/png'),
      thumbBuffer ? uploadToS3(thumbKey, thumbBuffer, 'image/webp') : Promise.resolve(),
      previewBuffer ? uploadToS3(previewKey, previewBuffer, 'image/webp') : Promise.resolve(),
    ])

    // ── 4. Ensure tags (pre-compute tag IDs for auto-rating) ──
    // Move tag upserts inside transaction to prevent partial commits
    const tagNames = [...new Set((meta.tag_names || []).map((n: string) => n.toLowerCase().trim()).filter(Boolean))]
    // ponytail: artist comes as a dedicated field from sidecar, not "artist:xxx" string.
    // Upsert with category=artist directly — AI never has to infer it.
    const artistName = meta.artist_name ? String(meta.artist_name).toLowerCase().trim() : ''
    const tagIds: string[] = []

    // ── 5. Apply auto-rating (before Post insert, so rating is correct from start) ──
    let rating = 'safe'
    let autoRating: string | null = null

    if (tagNames.length > 0) {
      const rules = await db
        .select()
        .from(autoRatingRules)
        .where(inArray(autoRatingRules.tagName, tagNames))

      for (const rule of rules) {
        if (!rule) continue
        const targetRating = rule.targetRating as string
        const rank = RATING_RANK[targetRating] ?? 0
        if (rank > (RATING_RANK[rating] ?? 0)) {
          rating = targetRating
        }
      }
      if (rating !== 'safe') autoRating = rating
    }

    // ── 6. Create Post + tag upserts + post_tag associations in transaction ──
    let postId: string

    await db.transaction(async (tx: any) => {
      // Bulk upsert tags in a single statement; postCount++ for both new and existing rows
      if (tagNames.length > 0) {
        const rows = await tx.insert(tags)
          .values(tagNames.map(name => ({ name, category: 'general' as any, postCount: 1 })))
          .onConflictDoUpdate({
            target: tags.name,
            set: { postCount: sql`${tags.postCount} + 1` },
          })
          .returning({ id: tags.id, name: tags.name })
        for (const r of rows) tagIds.push(r.id)
      }

      // Artist tag: dedicated upsert with category=artist
      if (artistName) {
        const [tag] = await tx
          .insert(tags)
          .values({ name: artistName, category: 'artist' as any, postCount: 1 })
          .onConflictDoUpdate({
            target: tags.name,
            set: {
              postCount: sql`${tags.postCount} + 1`,
              // Fix existing mis-categorized artist tags in place
              category: 'artist' as any,
              aiProcessedAt: new Date(),
            },
          })
          .returning({ id: tags.id })
        if (tag?.id && !tagIds.includes(tag.id)) tagIds.push(tag.id)
      }

      const [post] = await tx
        .insert(posts)
        .values({
          s3Key: imageKey,
          thumbKey: thumbKey || imageKey,
          previewKey: previewKey || imageKey,
          sourceUrl: meta.source_url,
          sourceSite,
          sourceId: meta.source_id,
          width: width ?? 0,
          height: height ?? 0,
          fileSize: meta.file_size,
          mimeType: mimeType || 'image/png',
          phash: result.phash || '',
          lqip: lqipDataUri,
          title: meta.title || null,
          description: meta.description || null,
          rating: rating as any,
        })
        .returning({ id: posts.id })

      postId = post.id

      // Bulk insert post_tags
      if (tagIds.length > 0) {
        await tx
          .insert(postTags)
          .values(tagIds.map(tid => ({ postId: postId, tagId: tid })))
          .onConflictDoNothing()
      }
    })

    // ── 7. AI tag processing (non-blocking) ──
    if (process.env.ENABLE_AI_TAG_PROCESSING === 'true') {
      try { await aiProcessTagsForPost(postId!, tagIds) }
      catch (e) { console.warn('[pipeline] AI tag processing failed (non-blocking):', e) }
    }

    return {
      status: 'success',
      post_id: postId!,
      source_site: meta.source_site,
      source_id: meta.source_id,
      auto_rating: autoRating || undefined,
    }
  } catch (err: any) {
    console.error('[pipeline] processResult error:', err)
    return { status: 'failed', error: err.message || 'Pipeline error' }
  }
}
