-- ponytail: add reverse index on post_tags.tag_id.
-- PK (post_id, tag_id) leaves every WHERE tag_id = ?/IN (.?) seq-scanning.
-- Covers listTags safeCount subquery, search EXISTS, autocomplete EXISTS,
-- tag-merge counts, and the post_tags UPDATE during merge.
CREATE INDEX "ix_post_tags_tag_id" ON "post_tags" USING btree ("tag_id");
