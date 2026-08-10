-- H17 + M17 + M19: 排序 tiebreaker 与查询索引（手写迁移，不经过 drizzle-kit）。
-- H17: (created_at DESC, id DESC) 稳定翻页排序，替换单列 ix_posts_created_at。
DROP INDEX IF EXISTS "ix_posts_created_at";
CREATE INDEX "ix_posts_created_at_id" ON "posts" USING btree ("created_at" DESC, "id" DESC);

-- M17: 搜索 EXISTS 子查询 (tag_id, post_id) 复合索引
CREATE INDEX IF NOT EXISTS "ix_post_tags_tag_id_post_id" ON "post_tags" USING btree ("tag_id", "post_id");

-- M19: admin/tags name LIKE 'x%' 前缀查询 — text_pattern_ops B-tree
CREATE INDEX IF NOT EXISTS "ix_tags_name_prefix" ON "tags" USING btree ("name" text_pattern_ops);
