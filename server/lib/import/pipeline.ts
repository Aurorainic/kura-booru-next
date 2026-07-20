/**
 * Pipeline consumer: processes sidecar results → creates Posts, thumbnails, S3 uploads.
 *
 * Consumed by 01-pipeline-worker.ts Nitro plugin. Each result flows through:
 *   decode → dedup → thumbnails → S3 → DB insert → tags → auto-rating → notify
 *
 * v0.9.0 R2.4: split into modules/import/steps/ (dedup, thumbnails, upload,
 * rating, tags). Single-image and multi-image paths share the same steps;
 * the difference (return duplicate vs throw PIPELINE_DUP, series_id stamping)
 * is parameterized in the orchestration.
 */

import crypto from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../utils/db'
import { posts } from '../../schema/posts'
import { postTags } from '../../schema/post_tags'
import type { SidecarResult, PipelineResult } from '../../utils/queue'
import { checkDuplicate } from './steps/dedup'
import { generateThumbnails } from './steps/thumbnails'
import { uploadImages } from './steps/upload'
import { computeRating } from './steps/rating'
import { upsertTags, associateTags } from './steps/tags'

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
    const dupId = await checkDuplicate(result.phash || '')
    if (dupId) {
      return { status: 'duplicate', existing_post_id: dupId, source_site: meta.source_site, source_id: meta.source_id }
    }

    // ── 2. Generate thumbnails (sharp) + probe metadata ──
    const thumbs = await generateThumbnails(imageBuffer, meta.width, meta.height, meta.mime_type)

    // ── 3. Upload to S3 ──
    const upload = await uploadImages(imageBuffer, thumbs, thumbs.mimeType)

    // ── 4. Ensure tags (pre-compute tag IDs for auto-rating) ──
    const tagNames = [...new Set((meta.tag_names || []).map((n: string) => n.toLowerCase().trim()).filter(Boolean))]
    const artistName = meta.artist_name ? String(meta.artist_name).toLowerCase().trim() : ''

    // ── 5. Apply auto-rating (before Post insert, so rating is correct from start) ──
    const { rating, autoRating } = await computeRating(tagNames, forceRating)

    // ── 6. Create Post + tag upserts + post_tag associations in transaction ──
    let postId: string

    await db.transaction(async (tx: any) => {
      const tagIds = await upsertTags(tx, tagNames, artistName)

      const [post] = await tx
        .insert(posts)
        .values({
          s3Key: upload.imageKey,
          thumbKey: upload.thumbKey || upload.imageKey,
          previewKey: upload.previewKey || upload.imageKey,
          sourceUrl: meta.source_url,
          sourceSite,
          sourceId: meta.source_id,
          width: thumbs.width ?? 0,
          height: thumbs.height ?? 0,
          fileSize: meta.file_size,
          mimeType: thumbs.mimeType || 'image/png',
          phash: result.phash || '',
          lqip: thumbs.lqipDataUri,
          title: meta.title || null,
          description: meta.description || null,
          rating: rating as any,
        })
        .returning({ id: posts.id })

      postId = post.id

      await associateTags(tx, postId, tagIds)
    })

    // ── 7. AI tag processing (non-blocking) ──
    if (isAiEnabled()) {
      try { await aiProcessTagsForPost(postId!, []) }
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

  // Detect existing series for this source. If the anchor (page_index=1)
  // row already exists, reuse its series_id and treat this import as
  // idempotent. Unique constraint (source_site, source_id, page_index) is
  // the final guard against duplicate series inserts — see catch below.
  //
  // Also detect a legacy single-image import (page_index IS NULL, pre-PR-C)
  // of the same source: its row coexists with new series rows because NULLs
  // are distinct under the unique index. If found, adopt it — stamp its
  // page_index=1 and series_id=own.id so it becomes the anchor instead of
  // inserting a duplicate. Otherwise by-source lookup would non-determin-
  // ically return either the stale single-image row or the new anchor.
  const existingAnchor = await db
    .select({ id: posts.id, seriesId: posts.seriesId })
    .from(posts)
    .where(sql`${posts.sourceSite} = ${sourceSite} AND ${posts.sourceId} = ${meta.source_id} AND (${posts.pageIndex} = 1 OR ${posts.pageIndex} IS NULL)`)
    .orderBy(sql`CASE WHEN ${posts.pageIndex} = 1 THEN 0 ELSE 1 END`)
    .limit(1)

  // ponytail: pre-generate the series_id BEFORE any insert. The old pattern
  // (insert anchor with series_id=NULL, then UPDATE series_id=own.id in the
  // same tx) created a cross-worker read-back race: a concurrent loser of
  // the 23505 recovery could read winner.seriesId=NULL (between the winner's
  // INSERT and its UPDATE, or if the winner's tx rolled back). Pre-generating
  // the UUID means every page in this import — and every concurrent loser —
  // can stamp the known series_id up-front, no read-back.
  let seriesId: string
  if (existingAnchor[0]?.seriesId) {
    seriesId = existingAnchor[0].seriesId
  } else if (existingAnchor[0]) {
    // Legacy NULL row exists but has no series_id yet — adopt it: it'll be
    // re-stamped as the anchor (page_index=1, series_id=its-own-id) below.
    seriesId = crypto.randomUUID()
  } else {
    // First import of this illust. Anchor (page_index=1) will stamp this id.
    seriesId = crypto.randomUUID()
  }
  const adoptLegacyId: string | null = existingAnchor[0] && !existingAnchor[0].seriesId
    ? existingAnchor[0]!.id
    : null

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
        adoptLegacyId: page.page_index === 1 ? adoptLegacyId : null,
      })

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
          // Concurrent winner stamped the series_id up-front (pre-generated
          // UUID), so it's never NULL here. Defensive fallback kept for
          // rows inserted by pre-fix code that still has series_id=NULL.
          if (page.page_index === 1 && winnerSeriesId) {
            seriesId = winnerSeriesId
          }
          pageResults.push({ page_index: page.page_index, status: 'duplicate', post_id: winnerId })
        } else {
          pageResults.push({ page_index: page.page_index, status: 'failed', error: 'unique violation but row not found' })
        }
        continue
      }
      // PIPELINE_DUP: per-page phash dedup hit — skip this page, don't fail the series.
      if (err?.code === 'PIPELINE_DUP') {
        pageResults.push({ page_index: page.page_index, status: 'duplicate', post_id: err.dupId })
        continue
      }
      pageResults.push({ page_index: page.page_index, status: 'failed', error: err.message || 'insert error' })
    }
  }

  // v0.7.8 PR-C: page_count is denormalized — every row stores the series
  // total. If some pages failed (sharp/S3/non-23505 error), the declared
  // page_count on the survivors is now wrong. Reconcile to the ACTUAL
  // number of successfully-inserted rows in this series so getPost's nav
  // shows the real count. (getPost also clamps to visible-page count, but
  // the stored hint should be correct for admin viewers who see all rows.)
  const successCount = pageResults.filter(r => r.status === 'success' || r.status === 'duplicate').length
  if (successCount > 0) {
    await db.update(posts)
      .set({ pageCount: successCount })
      .where(eq(posts.seriesId, seriesId))
      .catch(err => console.error('[pipeline] page_count reconcile failed:', err))
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
 * `seriesId` is a pre-generated UUID shared by every page in this import
 * (see processMultiImageResult) — never null. This eliminates the old
 * "insert anchor with NULL, then UPDATE own.id" read-back race.
 *
 * If `adoptLegacyId` is set, this is the anchor (page_index=1) AND a legacy
 * single-image row (page_index IS NULL) of the same source exists: UPDATE
 * that row in place to become the anchor instead of inserting a duplicate.
 *
 * Side effect on success: AI tag processing runs non-blocking on each page.
 */
async function insertOnePage(args: {
  imageBuffer: Buffer
  meta: NonNullable<SidecarResult['metadata']>
  page: NonNullable<NonNullable<SidecarResult['metadata']>['pages']>[number]
  seriesId: string
  pageIndex: number
  pageCount: number
  forceRating?: 'safe' | 'questionable' | 'explicit'
  sourceSite: 'pixiv' | 'twitter' | 'danbooru' | 'other'
  adoptLegacyId?: string | null
}): Promise<string> {
  const { imageBuffer, meta, page, seriesId, pageIndex, pageCount, forceRating, sourceSite, adoptLegacyId } = args

  // ── phash dedup (per page) ──
  const dupId = await checkDuplicate(page.phash || '')
  if (dupId) {
    // ponytail: don't throw pipeline-fatal — return the dup id and let the
    // caller decide. For multi-image that means "this page already exists,
    // skip it". We signal via thrown error so the loop's try-catch sees it.
    const e: any = new Error('duplicate')
    e.code = 'PIPELINE_DUP'
    e.dupId = dupId
    throw e
  }

  // ── Thumbnail + preview + LQIP (sharp; same pattern as single-image) ──
  const thumbs = await generateThumbnails(imageBuffer, page.width, page.height, page.mime_type)

  // ── S3 upload ──
  const upload = await uploadImages(imageBuffer, thumbs, thumbs.mimeType)

  // ── Tag upserts + auto-rating (mirrors single-image path; identical shapes) ──
  const tagNames = [...new Set((meta.tag_names || []).map((n: string) => n.toLowerCase().trim()).filter(Boolean))]
  const artistName = meta.artist_name ? String(meta.artist_name).toLowerCase().trim() : ''
  const { rating } = await computeRating(tagNames, forceRating)

  // ── Insert Post (or adopt legacy row). seriesId is a pre-generated UUID,
  //    never null — no read-back race. ──
  let postId: string
  await db.transaction(async (tx: any) => {
    const tagIds = await upsertTags(tx, tagNames, artistName)

    if (adoptLegacyId && pageIndex === 1) {
      // Legacy single-image row of the same source exists (page_index IS
      // NULL). Promote it to the anchor: stamp series_id=its-own-id +
      // page_index=1 + page_count, and rewrite its S3/dims to this page's
      // (page 1) values. No new row inserted.
      const [updated] = await tx.update(posts)
        .set({
          s3Key: upload.imageKey,
          thumbKey: upload.thumbKey || upload.imageKey,
          previewKey: upload.previewKey || upload.imageKey,
          sourceUrl: meta.source_url,
          sourceSite,
          sourceId: meta.source_id,
          width: thumbs.width ?? 0,
          height: thumbs.height ?? 0,
          fileSize: page.file_size,
          mimeType: thumbs.mimeType || 'image/png',
          phash: page.phash,
          lqip: thumbs.lqipDataUri,
          title: meta.title || null,
          description: meta.description || null,
          rating: rating as any,
          seriesId: adoptLegacyId,
          pageIndex,
          pageCount,
        })
        .where(eq(posts.id, adoptLegacyId))
        .returning({ id: posts.id })
      postId = updated.id
    } else {
      const [post] = await tx.insert(posts)
        .values({
          s3Key: upload.imageKey,
          thumbKey: upload.thumbKey || upload.imageKey,
          previewKey: upload.previewKey || upload.imageKey,
          sourceUrl: meta.source_url,
          sourceSite,
          sourceId: meta.source_id,
          width: thumbs.width ?? 0,
          height: thumbs.height ?? 0,
          fileSize: page.file_size,
          mimeType: thumbs.mimeType || 'image/png',
          phash: page.phash,
          lqip: thumbs.lqipDataUri,
          title: meta.title || null,
          description: meta.description || null,
          rating: rating as any,
          seriesId,
          pageIndex,
          pageCount,
        })
        .returning({ id: posts.id })
      postId = post.id
    }

    await associateTags(tx, postId, tagIds)
  })

  if (isAiEnabled()) {
    try { await aiProcessTagsForPost(postId!, []) }
    catch (e) { console.warn('[pipeline] AI tag processing failed (non-blocking):', e) }
  }

  return postId!
}
