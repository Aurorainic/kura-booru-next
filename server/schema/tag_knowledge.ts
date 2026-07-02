import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const tagKnowledge = pgTable('tag_knowledge', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  danbooruName: text('danbooru_name'),
  // ponytail: type/source are plain text, not PG enums — matches existing schema
  type: text('type').notNull(),
  translation: text('translation'),
  source: text('source').notNull().default('ai'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  nameIdx: uniqueIndex('ix_tag_knowledge_name').on(t.name),
}))
