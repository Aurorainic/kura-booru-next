-- v0.7.8 PR-C: Pixiv multi-image series (LAI-24). Adds nullable series_id /
-- page_index / page_count to posts; no backfill — legacy rows stay NULL and
-- read as single-image. Unique (source_site, source_id, page_index) doubles as
-- the series dedup key; PG treats NULLs as distinct, so legacy rows don't
-- collide. Non-unique ix_posts_series_id serves series-nav.

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
