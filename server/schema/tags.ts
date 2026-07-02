import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tagCategoryEnum } from './enums'

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  category: tagCategoryEnum('category').notNull(),
  postCount: integer('post_count').notNull().default(0),
  danbooruName: text('danbooru_name'),
  translation: text('translation'),
  aiProcessedAt: timestamp('ai_processed_at', { withTimezone: true }),
}, (t) => ({
  nameTrgmIdx: index('ix_tags_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
  translationTrgmIdx: index('ix_tags_translation_trgm').using('gin', sql`${t.translation} gin_trgm_ops`),
  danbooruNameTrgmIdx: index('ix_tags_danbooru_name_trgm').using('gin', sql`${t.danbooruName} gin_trgm_ops`),
  postCountIdx: index('ix_tags_post_count').on(t.postCount),
}))
