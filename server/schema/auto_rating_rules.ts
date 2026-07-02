import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { ratingEnum } from './enums'

export const autoRatingRules = pgTable('auto_rating_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tagName: text('tag_name').notNull().unique(),
  targetRating: ratingEnum('target_rating').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tagIdx: uniqueIndex('ix_auto_rating_rules_tag_name').on(t.tagName),
}))
