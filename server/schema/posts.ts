import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { sourceSiteEnum, ratingEnum } from './enums'

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  s3Key: text('s3_key').notNull(),
  thumbKey: text('thumb_key').notNull(),
  previewKey: text('preview_key').notNull(),
  sourceUrl: text('source_url').notNull(),
  sourceSite: sourceSiteEnum('source_site').notNull(),
  sourceId: text('source_id').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  phash: text('phash').notNull(),      // ponytail: not exposed in API responses
  lqip: text('lqip'),                 // 20×20 base64 webp blur placeholder, embedded in API response
  title: text('title'),
  description: text('description'),
  rating: ratingEnum('rating').notNull().default('safe'),
  // v0.7.8 PR-C: Pixiv multi-image series. Nullable so existing 604 posts (and
  // any imported pre-merge) read as "single image" — no backfill per user
  // decision (2026-07-14). page_count is redundant with COUNT but cheap to
  // store; lets /api/posts/[id] skip a join just to read the total.
  seriesId: uuid('series_id'),
  pageIndex: integer('page_index'),
  pageCount: integer('page_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  aiTagProcessedAt: timestamp('ai_tag_processed_at', { withTimezone: true }),
  aiTagStatus: text('ai_tag_status').notNull().default('pending'),
}, (t) => ({
  // ponytail: (site, id, page_index) is the new dedup key — covers both
  // single-image rows (page_index IS NULL — NULLs don't collide in PG
  // unique indexes) and series rows. NULLs are distinct from each other
  // by spec, so legacy single-image imports don't conflict with PR-C
  // multi-image imports of the same (site, source_id).
  seriesSourceIdx: uniqueIndex('ix_posts_source_site_id_page')
    .on(t.sourceSite, t.sourceId, t.pageIndex),
  seriesIdIdx: index('ix_posts_series_id').on(t.seriesId),
  createdAtIdx: index('ix_posts_created_at').on(t.createdAt),
  ratingIdx: index('ix_posts_rating').on(t.rating),
  phashIdx: index('ix_posts_phash').on(t.phash),
  titleTrgmIdx: index('ix_posts_title_trgm').using('gin', sql`${t.title} gin_trgm_ops`),
}))
