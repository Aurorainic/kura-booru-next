import { pgTable, uuid, primaryKey, index } from 'drizzle-orm/pg-core'
import { posts } from './posts'
import { tags } from './tags'

export const postTags = pgTable('post_tags', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.postId, t.tagId] }),
  // ponytail: PK is (post_id, tag_id) — every WHERE tag_id= seq-scans without this.
  // Reverse index covers listTags safeCount subquery, search EXISTS, autocomplete
  // EXISTS, tag-merge counts and the post_tags UPDATE during merge.
  tagIdx: index('ix_post_tags_tag_id').on(t.tagId),
}))
