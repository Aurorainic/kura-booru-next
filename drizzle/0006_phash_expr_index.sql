-- v0.9.0 B6: phash prefix expression index.
--
-- pipeline.ts:69 queries `left(phash, 4) = prefix` for dedup bucket lookup.
-- A plain btree on the full phash column can't serve a left() expression —
-- Postgres would have to seq-scan and compute left() per row. This expression
-- index makes the prefix lookup an index scan instead.
--
-- Idempotent: IF NOT EXISTS so re-running is safe.
CREATE INDEX IF NOT EXISTS ix_posts_phash_prefix ON posts (left(phash, 4));
