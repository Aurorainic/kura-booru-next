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

export async function processResult(result: SidecarResult, forceRating?: 'safe' | 'questionable' | 'explicit'): Promise<PipelineResult> {
  if (result.status === 'error') {
    return { status: 'failed', error: result.error || 'Unknown error' }
  }

  // v0.7.8 PR-C: multi-image Pixiv illusts come back as a single sidecar
  // result with metadata.pages[] and metadata.is_multi=true. Dispatch to
  // the single-image path per page in series order, collecting the post ids
  // into a single response. Order matters: page_index 1 is the series
  // anchor (its id becomes series_id) so we MUST insert it first.
  if (result.metadata?.is_multi && result.metadata.pages?.length) {
    return processMultiImageResult(result, forceRating)
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

    // ponytail: 3 concurrent S3 uploads per pipeline run. With a single worker
    // this is fine. If a worker pool is added later, cap at e.g. 2 concurrent
    // to avoid saturating the S3 connection pool — image is the largest
    // (full-resolution), thumb+preview can wait.
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
    // ponytail: force_rating (from extension key path) bypasses the rule scan
    // entirely — user-specified rating wins, no auto_rating return value.
    let rating = 'safe'
    let autoRating: string | null = null

    if (forceRating) {
      rating = forceRating
    } else if (tagNames.length > 0) {
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

/**
 * v0.7.8 PR-C: process a multi-image Pixiv illust end-to-end.
 *
 * Returns the standard single-post PipelineResult shape, but post_id points
 * at the series anchor (page_index=1). The remaining N-1 page ids are
 * available via the original result.metadata.pages lookup; they aren't in
 * the response shape because the bot only cares about "did the import
 * succeed". The series id of the anchor IS the series_id of the whole set,
 * so bot-side API lookup `/api/posts/by-source?source_id=...` returns the
 * first page and the detail page's series nav reveals the rest.
 */
async function processMultiImageResult(
  result: SidecarResult,
  forceRating?: 'safe' | 'questionable' | 'explicit',
): Promise<PipelineResult> {
  if (!result.metadata) {
    return { status: 'failed', error: 'No metadata for multi-image result' }
  }
  const meta = result.metadata
  const pages = meta.pages ?? []
  if (!pages.length) return { status: 'failed', error: 'Multi-image result with zero pages' }

  const VALID_SOURCES = new Set(['pixiv', 'twitter', 'danbooru', 'other'])
  const sourceSite = VALID_SOURCES.has(meta.source_site) ? meta.source_site as any : 'other' as any
  const declaredPageCount = meta.page_count ?? pages.length

  // Sort pages by page_index so we always insert the series anchor (page_index=1) first.
  const sortedPages = [...pages].sort((a, b) => a.page_index - b.page_index)

  // Detect existing series for this source. If the anchor (page_index=1) row
  // already exists, reuse its series_id and treat this import as idempotent.
  // Unique constraint (source_site, source_id, page_index) is the final guard
  // against duplicate series inserts — see catch below.
  const existingAnchor = await db
    .select({ id: posts.id })
    .from(posts)
    .where(sql`${posts.sourceSite} = ${sourceSite} AND ${posts.sourceId} = ${meta.source_id} AND ${posts.pageIndex} = 1`)
    .limit(1)

  let seriesId: string | null
  if (existingAnchor[0]) {
    seriesId = existingAnchor[0].id
  } else {
    // We are the first import of this illust. After we insert page_index=1,
    // that row's id becomes series_id for every page in this transaction.
    seriesId = null  // marker; insertOnePage stamps series_id=id on the anchor row
  }

  // Per-page result containers.
  const pageResults: Array<{ page_index: number; status: 'success' | 'duplicate' | 'failed'; post_id?: string; error?: string }> = []

  for (const page of sortedPages) {
    const imageBuffer = Buffer.from(page.image_bytes_b64, 'base64')

    // Per-page MAX_IMAGE_SIZE check (sidecar already filtered too-larges, but
    // belt-and-suspenders in case env changes between sidecar and pipeline).
    const maxSize = parseInt(process.env.MAX_IMAGE_SIZE || '0', 10)
    if (maxSize > 0 && imageBuffer.length > maxSize) {
      pageResults.push({ page_index: page.page_index, status: 'failed', error: 'too_large' })
      continue
    }

    try {
      const newId = await insertOnePage({
        imageBuffer,
        meta,
        page,
        seriesId,
        pageIndex: page.page_index,
        pageCount: declaredPageCount,
        forceRating,
        sourceSite,
      })

      // If we just inserted the anchor page_index=1, its postId becomes the
      // series_id — refresh our local so subsequent pages get the right FK.
      if (seriesId === null && page.page_index === 1) {
        seriesId = newId
      }

      pageResults.push({ page_index: page.page_index, status: 'success', post_id: newId })
    } catch (err: any) {
      // 23505 = unique violation on (source_site, source_id, page_index).
      // Meaning: a concurrent worker (or a retry from this same illust) won
      // the race to insert this page_index. Re-SELECT to get the canonical row.
      if (err?.code === '23505') {
        const winner = await db
          .select({ id: posts.id, seriesId: posts.seriesId })
          .from(posts)
          .where(sql`${posts.sourceSite} = ${sourceSite} AND ${posts.sourceId} = ${meta.source_id} AND ${posts.pageIndex} = ${page.page_index}`)
          .limit(1)
        const winnerId = winner[0]?.id
        const winnerSeriesId = winner[0]?.seriesId
        if (winnerId) {
          // If we were the would-be anchor, hand off to the winner's series_id.
          if (seriesId === null && page.page_index === 1) {
            seriesId = winnerSeriesId ?? winnerId
          }
          pageResults.push({ page_index: page.page_index, status: 'duplicate', post_id: winnerId })
        } else {
          pageResults.push({ page_index: page.page_index, status: 'failed', error: 'unique violation but row not found' })
        }
        continue
      }
      pageResults.push({ page_index: page.page_index, status: 'failed', error: err.message || 'insert error' })
    }
  }

  const anchorPage = pageResults.find(r => r.page_index === 1)
  if (!anchorPage?.post_id) {
    return { status: 'failed', error: 'series anchor (page_index=1) did not insert', source_site: meta.source_site, source_id: meta.source_id }
  }

  return {
    status: 'success',
    post_id: anchorPage.post_id,
    source_site: meta.source_site,
    source_id: meta.source_id,
  }
}

/**
 * Insert one page from a multi-image illust. Mirrors the single-image path
 * but takes page-specific dims/phash and stamps series_id/page_index/page_count
 * on the row. Returns the inserted post id.
 *
 * If `seriesId` is null, this is the anchor page (page_index=1) being
 * inserted without a known series anchor yet — caller must UPDATE the row
 * to set series_id=id afterward (the series is born from its first page).
 *
 * Side effect on success: AI tag processing runs non-blocking on each page.
 */
async function insertOnePage(args: {
  imageBuffer: Buffer
  meta: NonNullable<SidecarResult['metadata']>
  page: NonNullable<NonNullable<SidecarResult['metadata']>['pages']>[number]
  seriesId: string | null
  pageIndex: number
  pageCount: number
  forceRating?: 'safe' | 'questionable' | 'explicit'
  sourceSite: 'pixiv' | 'twitter' | 'danbooru' | 'other'
}): Promise<string> {
  const { imageBuffer, meta, page, seriesId, pageIndex, pageCount, forceRating, sourceSite } = args

  // ── phash dedup (per page) ──
  if (page.phash && /^[0-9a-f]+$/i.test(page.phash) && page.phash.length >= 4) {
    const prefix = page.phash.slice(0, 4)
    const candidates = await db
      .select({ id: posts.id, phash: posts.phash })
      .from(posts)
      .where(sql`left(${posts.phash}, 4) = ${prefix}`)
    const dupId = findDuplicateByPhash(candidates as { id: string; phash: string }[], page.phash)
    if (dupId) {
      // ponytail: don't throw pipeline-fatal — return the dup id and let the
      // caller decide. For multi-image that means "this page already exists,
      // skip it". We signal via thrown error so the loop's try-catch sees it.
      const e: any = new Error('duplicate')
      e.code = 'PIPELINE_DUP'
      e.dupId = dupId
      throw e
    }
  }

  // ── Thumbnail + preview + LQIP (sharp; same pattern as single-image) ──
  const sharpMod = await getSharp()
  let thumbBuffer: Buffer | null = null
  let previewBuffer: Buffer | null = null
  let lqipDataUri: string | null = null
  let width = page.width
  let height = page.height
  let mimeType = page.mime_type

  if (sharpMod) {
    const img = sharpMod.default(imageBuffer)
    ;[thumbBuffer, previewBuffer] = await Promise.all([
      img.clone().resize(300, 300, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(),
      img.clone().resize(1280, undefined, { fit: 'inside' }).webp({ quality: 85 }).toBuffer(),
    ])
    const lqipBuf = await img.clone()
      .resize(20, 20, { fit: 'cover' })
      .blur(2)
      .webp({ quality: 40 })
      .toBuffer()
    lqipDataUri = `data:image/webp;base64,${lqipBuf.toString('base64')}`

    const probed = await img.metadata()
    if (probed.width && probed.height) { width = probed.width; height = probed.height }
    if (probed.format) mimeType = `image/${probed.format === 'jpeg' ? 'jpeg' : probed.format}`
  }

  // ── S3 upload ──
  const ext = mimeType?.split('/')[1] || 'png'
  const imageKey = `${crypto.randomUUID()}.${ext}`
  const thumbKey = thumbBuffer ? `${crypto.randomUUID()}.webp` : ''
  const previewKey = previewBuffer ? `${crypto.randomUUID()}.webp` : ''

  await Promise.all([
    uploadToS3(imageKey, imageBuffer, mimeType || 'image/png'),
    thumbBuffer ? uploadToS3(thumbKey, thumbBuffer, 'image/webp') : Promise.resolve(),
    previewBuffer ? uploadToS3(previewKey, previewBuffer, 'image/webp') : Promise.resolve(),
  ])

  // ── Tag upserts + auto-rating (mirrors single-image path; identical shapes) ──
  const tagNames = [...new Set((meta.tag_names || []).map((n: string) => n.toLowerCase().trim()).filter(Boolean))]
  const artistName = meta.artist_name ? String(meta.artist_name).toLowerCase().trim() : ''
  const tagIds: string[] = []

  let rating = 'safe'
  if (forceRating) {
    rating = forceRating
  } else if (tagNames.length > 0) {
    const rules = await db
      .select()
      .from(autoRatingRules)
      .where(inArray(autoRatingRules.tagName, tagNames))
    for (const rule of rules) {
      const targetRating = rule.targetRating as string
      const rank = RATING_RANK[targetRating] ?? 0
      if (rank > (RATING_RANK[rating] ?? 0)) {
        rating = targetRating
      }
    }
  }

  // ── Insert Post with series metadata. Default series_id is null on the
  //    anchor row — we'll UPDATE in the same transaction after we know its id. ──
  let postId: string
  await db.transaction(async (tx: any) => {
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
    if (artistName) {
      const [tag] = await tx.insert(tags)
        .values({ name: artistName, category: 'artist' as any, postCount: 1 })
        .onConflictDoUpdate({
          target: tags.name,
          set: {
            postCount: sql`${tags.postCount} + 1`,
            category: 'artist' as any,
            aiProcessedAt: new Date(),
          },
        })
        .returning({ id: tags.id })
      if (tag?.id && !tagIds.includes(tag.id)) tagIds.push(tag.id)
    }

    const [post] = await tx.insert(posts)
      .values({
        s3Key: imageKey,
        thumbKey: thumbKey || imageKey,
        previewKey: previewKey || imageKey,
        sourceUrl: meta.source_url,
        sourceSite,
        sourceId: meta.source_id,
        width: width ?? 0,
        height: height ?? 0,
        fileSize: page.file_size,
        mimeType: mimeType || 'image/png',
        phash: page.phash,
        lqip: lqipDataUri,
        title: meta.title || null,
        description: meta.description || null,
        rating: rating as any,
        seriesId: seriesId,          // null when this is the anchor being born
        pageIndex,
        pageCount,
      })
      .returning({ id: posts.id })
    postId = post.id

    // Anchor: stamp series_id = own id, finalize page_count. Run only when
    // we don't already know it (i.e. we're the first page of the series).
    if (seriesId === null && pageIndex === 1) {
      await tx.update(posts)
        .set({ seriesId: postId, pageCount })
        .where(eq(posts.id, postId))
    }

    if (tagIds.length > 0) {
      await tx.insert(postTags)
        .values(tagIds.map(tid => ({ postId, tagId: tid })))
        .onConflictDoNothing()
    }
  })

  if (process.env.ENABLE_AI_TAG_PROCESSING === 'true') {
    try { await aiProcessTagsForPost(postId!, tagIds) }
    catch (e) { console.warn('[pipeline] AI tag processing failed (non-blocking):', e) }
  }

  return postId!
}
