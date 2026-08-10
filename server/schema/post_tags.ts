import { pgTable, uuid, primaryKey, index } from 'drizzle-orm/pg-core'
import { posts } from './posts'
import { tags } from './tags'

export const postTags = pgTable('post_tags', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.postId, t.tagId] }),
  tagIdx: index('ix_post_tags_tag_id').on(t.tagId),
  // M17: 搜索 EXISTS 子查询是 (tag_id = ? AND post_id = ?) — 复合索引覆盖
  tagPostIdx: index('ix_post_tags_tag_id_post_id').on(t.tagId, t.postId),
}))
