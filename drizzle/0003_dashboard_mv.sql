-- MV of counts/totals for /api/admin/dashboard; refreshed in-process every 5 min (06-dashboard-refresh.ts)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_stats AS
SELECT
  1::int AS id,
  (SELECT count(*) FROM posts) AS total_posts,
  (SELECT count(*) FROM tags) AS total_tags,
  (SELECT count(*) FROM post_tags) AS total_post_tags,
  (SELECT coalesce(sum(file_size), 0) FROM posts) AS total_file_size_bytes,
  now() AS refreshed_at
WITH NO DATA;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY (no exclusive lock).
CREATE UNIQUE INDEX IF NOT EXISTS ix_mv_dashboard_stats_id ON mv_dashboard_stats (id);

-- First populate so the first request after deploy isn't served an empty dashboard
INSERT INTO mv_dashboard_stats (id, total_posts, total_tags, total_post_tags, total_file_size_bytes, refreshed_at)
SELECT 1,
  (SELECT count(*) FROM posts),
  (SELECT count(*) FROM tags),
  (SELECT count(*) FROM post_tags),
  (SELECT coalesce(sum(file_size), 0) FROM posts),
  now()
WHERE NOT EXISTS (SELECT 1 FROM mv_dashboard_stats WHERE id = 1);
