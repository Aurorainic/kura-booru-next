-- v0.7.8 PR-C: Pixiv multi-image series support (LAI-24, decided 2026-07-14).
--
-- Adds three nullable columns to posts: series_id (UUID anchor for the
-- multi-image set), page_index (current ordinal in the series), page_count
-- (denormalized total page count so reads don't need a join).
--
-- Backfill policy: NONE. Existing 604 posts stay series_id/page_index/page_count
-- IS NULL and are read as single-image rows. New Pixiv multi-image imports get
-- a fresh series_id chain.
--
-- Index strategy:
--   - Drop plain ix_posts_source_site_id (already unused for unique lookups —
--     dedup was always via phash). Replace with a partial-composite UNIQUE on
--     (source_site, source_id, page_index) that doubles as the dedup key for
--     series inserts and the lookup index for legacy single-image rows.
--   - Add a non-unique index on series_id for the series-nav query.
--
-- NOTE on NULLs in PG unique indexes: a UNIQUE index treats NULLs as distinct,
-- so legacy rows (page_index IS NULL) don't collide with new series rows or
-- with each other. The Drizzle schema's old `index(...)` is preserved as a
-- non-unique btree (`ix_posts_source_site_id`) for any path that joins on
-- (source_site, source_id) without filtering page_index.

ALTER TABLE "posts"
  ADD COLUMN "series_id" uuid,
  ADD COLUMN "page_index" integer,
  ADD COLUMN "page_count" integer;
--> statement-breakpoint
DROP INDEX IF EXISTS "ix_posts_source_site_id";
--> statement-breakpoint
CREATE UNIQUE INDEX "ix_posts_source_site_id_page"
  ON "posts" USING btree ("source_site","source_id","page_index");
--> statement-breakpoint
CREATE INDEX "ix_posts_series_id"
  ON "posts" USING btree ("series_id");
