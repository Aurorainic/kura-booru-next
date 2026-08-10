/**
 * Pipeline consumer (01-pipeline-worker.ts): sidecar result → Post, thumbnails, S3 uploads.
 * Flow: decode → dedup → thumbnails → S3 → DB insert → tags → auto-rating → notify.
 * Steps in modules/import/steps/; single vs multi-image differ only in dup handling and series_id stamping.
 */

import crypto from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../utils/db'
import { posts, postTags } from '../../schema'
import type { SidecarResult, PipelineResult } from '../../utils/queue'
import { checkDuplicate } from './steps/dedup'
import { generateThumbnails } from './steps/thumbnails'
import { uploadImages } from './steps/upload'
import { computeRating } from './steps/rating'
import { upsertTags, associateTags } from './steps/tags'
import { isAiEnabled } from '../ai/config'
import { aiProcessTagsForPost } from '../ai/reprocess'
import { identifySource, resolveSourceOrOther } from '../../utils/url-patterns'

const SOURCE_SITES = ['pixiv', 'twitter', 'danbooru', 'other'] as const
type SourceSite = typeof SOURCE_SITES[number]

function resolveSourceSite(meta: {
  source_url: string
  source_site?: string
  source_id?: string
}): { site: SourceSite; id: string } {
  const declared = SOURCE_SITES.includes(meta.source_site as SourceSite)
    ? meta.source_site as SourceSite
    : null
  if (declared) {
    return { site: declared, id: meta.source_id || 'unknown' }
  }

  // Old jobs lack source_site; recover from URL before falling back to "other".
  const detected = identifySource(meta.source_url) || resolveSourceOrOther(meta.source_url)
  return { site: detected.site as SourceSite, id: detected.id }
}

export async function processResult(result: SidecarResult, forceRating?: 'safe' | 'questionable' | 'explicit'): Promise<PipelineResult> {
  if (result.status === 'error') {
    return { status: 'failed', error: result.error || 'Unknown error' }
  }

  // Multi-image illust: one sidecar result with pages[]. Insert pages in series
  // order — page_index=1 is the anchor (its id becomes series_id), insert it first.
  if (result.metadata?.is_multi && result.metadata.pages?.length) {
    return processMultiImageResult(result, forceRating)
  }

  if (!result.image_bytes_b64 || !result.metadata) {
    return { status: 'failed', error: 'No image data or metadata in result' }
  }

  const imageBuffer = Buffer.from(result.image_bytes_b64, 'base64')
  const meta = result.metadata
  const source = resolveSourceSite(meta)

  // MAX_IMAGE_SIZE check (DB settings, hot-reload)
  const { getImageSizes } = await import('../../utils/settings')
  const maxSize = (await getImageSizes()).maxImageSize
  if (maxSize > 0 && imageBuffer.length > maxSize) {
    return { status: 'too_large', source_site: source.site, source_id: source.id }
  }

  try {
    const dupId = await checkDuplicate(result.phash || '')
    if (dupId) {
      return { status: 'duplicate', existing_post_id: dupId, source_site: source.site, source_id: source.id }
    }

    const thumbs = await generateThumbnails(imageBuffer, meta.width, meta.height, meta.mime_type)

    const upload = await uploadImages(imageBuffer, thumbs, thumbs.mimeType)

    const tagNames = [...new Set((meta.tag_names || []).map((n: string) => n.toLowerCase().trim()).filter(Boolean))]
    const artistName = meta.artist_name ? String(meta.artist_name).toLowerCase().trim() : ''

    // Auto-rate before Post insert so rating is correct from the start
    const { rating, autoRating } = await computeRating(tagNames, forceRating)

    let postId: string
    let tagIds: string[] = []

    await db.transaction(async (tx: any) => {
      tagIds = await upsertTags(tx, tagNames, artistName)

      const [post] = await tx
        .insert(posts)
        .values({
          s3Key: upload.imageKey,
          thumbKey: upload.thumbKey || upload.imageKey,
          previewKey: upload.previewKey || upload.imageKey,
          sourceUrl: meta.source_url,
          sourceSite: source.site,
          sourceId: source.id,
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

    // AI tag processing (non-blocking)
    if (isAiEnabled()) {
      try { await aiProcessTagsForPost(postId!, tagIds) }
      catch (e) { console.warn('[pipeline] AI tag processing failed (non-blocking):', e) }
    }

    return {
      status: 'success',
      post_id: postId!,
      source_site: source.site,
      source_id: source.id,
      auto_rating: autoRating || undefined,
    }
  } catch (err: any) {
    console.error('[pipeline] processResult error:', err)
    return { status: 'failed', error: err.message || 'Pipeline error' }
  }
}

/**
 * Process a multi-image Pixiv illust. post_id = series anchor (page_index=1);
 * its series_id is the whole set's, so by-source lookup returns the first page
 * and series nav reveals the rest.
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

  const source = resolveSourceSite(meta)
  const sourceSite = source.site
  const declaredPageCount = meta.page_count ?? pages.length

  // Insert the series anchor (page_index=1) first.
  const sortedPages = [...pages].sort((a, b) => a.page_index - b.page_index)

  // Existing anchor (page_index=1) → reuse its series_id (idempotent re-import);
  // unique (source_site, source_id, page_index) is the final guard (catch below).
  // Legacy single-image row (page_index IS NULL) coexists (NULLs distinct under
  // the unique index) — adopt it as the anchor, else by-source lookup would
  // non-deterministically return either the stale row or the new anchor.
  const existingAnchor = await db
    .select({ id: posts.id, seriesId: posts.seriesId })
    .from(posts)
    .where(sql`${posts.sourceSite} = ${sourceSite} AND ${posts.sourceId} = ${source.id} AND (${posts.pageIndex} = 1 OR ${posts.pageIndex} IS NULL)`)
    .orderBy(sql`CASE WHEN ${posts.pageIndex} = 1 THEN 0 ELSE 1 END`)
    .limit(1)

  let seriesId: string
  if (existingAnchor[0]?.seriesId) {
    seriesId = existingAnchor[0].seriesId
  } else if (existingAnchor[0]) {
    // Legacy NULL row — adopt; re-stamped as anchor (page_index=1, series_id=own id) below.
    seriesId = crypto.randomUUID()
  } else {
    // First import: anchor (page_index=1) stamps this id.
    seriesId = crypto.randomUUID()
  }
  const adoptLegacyId: string | null = existingAnchor[0] && !existingAnchor[0].seriesId
    ? existingAnchor[0]!.id
    : null

  const pageResults: Array<{ page_index: number; status: 'success' | 'duplicate' | 'failed'; post_id?: string; error?: string }> = []

  for (const page of sortedPages) {
    const imageBuffer = Buffer.from(page.image_bytes_b64, 'base64')

    // Re-check MAX_IMAGE_SIZE: settings may change between sidecar and pipeline.
    const { getImageSizes } = await import('../../utils/settings')
    const maxSize = (await getImageSizes()).maxImageSize
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
        sourceId: source.id,
        adoptLegacyId: page.page_index === 1 ? adoptLegacyId : null,
      })

      pageResults.push({ page_index: page.page_index, status: 'success', post_id: newId })
    } catch (err: any) {
      // 23505 = unique violation on (source_site, source_id, page_index):
      // concurrent worker won the race — re-SELECT the canonical row.
      if (err?.code === '23505') {
        const winner = await db
          .select({ id: posts.id, seriesId: posts.seriesId })
          .from(posts)
          .where(sql`${posts.sourceSite} = ${sourceSite} AND ${posts.sourceId} = ${source.id} AND ${posts.pageIndex} = ${page.page_index}`)
          .limit(1)
        const winnerId = winner[0]?.id
        const winnerSeriesId = winner[0]?.seriesId
        if (winnerId) {
          // Winner's series_id is pre-generated (never NULL); fallback kept for pre-fix rows.
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

  // page_count is denormalized per row; if pages failed, the stored count is
  // wrong — reconcile to the actual inserted rows so getPost nav shows the real count.
  const successCount = pageResults.filter(r => r.status === 'success' || r.status === 'duplicate').length
  if (successCount > 0) {
    await db.update(posts)
      .set({ pageCount: successCount })
      .where(eq(posts.seriesId, seriesId))
      .catch(err => console.error('[pipeline] page_count reconcile failed for seriesId=%s: %s', seriesId, err instanceof Error ? err.message : err))
  }

  const anchorPage = pageResults.find(r => r.page_index === 1)
  if (!anchorPage?.post_id) {
    return { status: 'failed', error: 'series anchor (page_index=1) did not insert', source_site: source.site, source_id: source.id }
  }

  return {
    status: 'success',
    post_id: anchorPage.post_id,
    source_site: source.site,
    source_id: source.id,
  }
}

/**
 * Insert one page of a multi-image illust: stamps series_id/page_index/page_count.
 * seriesId is pre-generated (never null — no read-back race). With adoptLegacyId,
 * UPDATE the legacy single-image row in place to become the anchor. AI tag
 * processing runs non-blocking on success.
 */
async function insertOnePage(args: {
  imageBuffer: Buffer
  meta: NonNullable<SidecarResult['metadata']>
  page: NonNullable<NonNullable<SidecarResult['metadata']>['pages']>[number]
  seriesId: string
  pageIndex: number
  pageCount: number
  forceRating?: 'safe' | 'questionable' | 'explicit'
  sourceSite: SourceSite
  sourceId: string
  adoptLegacyId?: string | null
}): Promise<string> {
  const { imageBuffer, meta, page, seriesId, pageIndex, pageCount, forceRating, sourceSite, sourceId, adoptLegacyId } = args

  const dupId = await checkDuplicate(page.phash || '')
  if (dupId) {
    const e: any = new Error('duplicate')
    e.code = 'PIPELINE_DUP'
    e.dupId = dupId
    throw e
  }

  // Thumbnails + preview + LQIP (sharp)
  const thumbs = await generateThumbnails(imageBuffer, page.width, page.height, page.mime_type)

  const upload = await uploadImages(imageBuffer, thumbs, thumbs.mimeType)

  // Tag upserts + auto-rating (mirrors single-image path)
  const tagNames = [...new Set((meta.tag_names || []).map((n: string) => n.toLowerCase().trim()).filter(Boolean))]
  const artistName = meta.artist_name ? String(meta.artist_name).toLowerCase().trim() : ''
  const { rating } = await computeRating(tagNames, forceRating)

  // Insert Post (or adopt legacy row); seriesId never null — no read-back race.
  let postId: string
  let tagIds: string[] = []
  await db.transaction(async (tx: any) => {
    tagIds = await upsertTags(tx, tagNames, artistName)

    if (adoptLegacyId && pageIndex === 1) {
      // Promote legacy single-image row (page_index IS NULL) to anchor:
      // stamp series_id=own id, page_index=1, page_count; rewrite S3/dims to page 1.
      const [updated] = await tx.update(posts)
        .set({
          s3Key: upload.imageKey,
          thumbKey: upload.thumbKey || upload.imageKey,
          previewKey: upload.previewKey || upload.imageKey,
          sourceUrl: meta.source_url,
          sourceSite,
          sourceId,
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
          sourceId,
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
    try { await aiProcessTagsForPost(postId!, tagIds) }
    catch (e) { console.warn('[pipeline] AI tag processing failed (non-blocking):', e) }
  }

  return postId!
}
