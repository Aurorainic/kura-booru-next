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
  phash: text('phash').notNull(),
  lqip: text('lqip'),                 // 20×20 base64 webp blur placeholder, embedded in API response
  title: text('title'),
  description: text('description'),
  rating: ratingEnum('rating').notNull().default('safe'),
  // v0.7.8 PR-C: Pixiv multi-image series. Nullable so pre-existing posts read
  // as "single image" (no backfill, 2026-07-14). page_count denormalized so
  // /api/posts/[id] skips a COUNT join for the total.
  seriesId: uuid('series_id'),
  pageIndex: integer('page_index'),
  pageCount: integer('page_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  aiTagProcessedAt: timestamp('ai_tag_processed_at', { withTimezone: true }),
  aiTagStatus: text('ai_tag_status').notNull().default('pending'),
}, (t) => ({
  seriesSourceIdx: uniqueIndex('ix_posts_source_site_id_page')
    .on(t.sourceSite, t.sourceId, t.pageIndex),
  seriesIdIdx: index('ix_posts_series_id').on(t.seriesId),
  // H17: 复合索引匹配 (created_at DESC, id DESC) 翻页排序，避免同秒 OFFSET/LIMIT 重复
  createdAtIdx: index('ix_posts_created_at_id').on(sql`${t.createdAt} DESC, ${t.id} DESC`),
  ratingIdx: index('ix_posts_rating').on(t.rating),
  phashIdx: index('ix_posts_phash').on(t.phash),
  titleTrgmIdx: index('ix_posts_title_trgm').using('gin', sql`${t.title} gin_trgm_ops`),
}))
