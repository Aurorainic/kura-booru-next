import { pgTable, uuid, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { tags } from './tags'

export const tagAliases = pgTable('tag_aliases', {
  id: uuid('id').primaryKey().defaultRandom(),
  aliasName: text('alias_name').notNull().unique(),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
})
