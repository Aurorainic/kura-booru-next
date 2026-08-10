-- v0.9.0 B6: expression index so the `left(phash, 4) = prefix` dedup lookup
-- (pipeline.ts:69) is an index scan, not a per-row seq-scan. IF NOT EXISTS — re-runnable.
CREATE INDEX IF NOT EXISTS ix_posts_phash_prefix ON posts (left(phash, 4));
