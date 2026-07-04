import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core'
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  aiTagProcessedAt: timestamp('ai_tag_processed_at', { withTimezone: true }),
  aiTagStatus: text('ai_tag_status').notNull().default('pending'),
}, (t) => ({
  sourceIdx: index('ix_posts_source_site_id').on(t.sourceSite, t.sourceId),
  createdAtIdx: index('ix_posts_created_at').on(t.createdAt),
  ratingIdx: index('ix_posts_rating').on(t.rating),
  phashIdx: index('ix_posts_phash').on(t.phash),
  titleTrgmIdx: index('ix_posts_title_trgm').using('gin', sql`${t.title} gin_trgm_ops`),
}))
