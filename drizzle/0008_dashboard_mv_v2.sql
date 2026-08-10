-- M16: dashboard 明细移入 MV — source/rating breakdown 不再每次请求全表 GROUP BY（原 ~50ms）。
-- MV 结构变更必须 DROP 重建（CONCURRENTLY 仅支持 REFRESH）。
DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_stats;

CREATE MATERIALIZED VIEW mv_dashboard_stats AS
SELECT
  1::int AS id,
  (SELECT count(*) FROM posts) AS total_posts,
  (SELECT count(*) FROM tags) AS total_tags,
  (SELECT count(*) FROM post_tags) AS total_post_tags,
  (SELECT coalesce(sum(file_size), 0) FROM posts) AS total_file_size_bytes,
  (SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
     FROM (SELECT source_site, count(*) AS count FROM posts GROUP BY source_site) x) AS source_breakdown,
  (SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
     FROM (SELECT rating, count(*) AS count FROM posts GROUP BY rating) x) AS rating_breakdown,
  now() AS refreshed_at
WITH NO DATA;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY (no exclusive lock).
CREATE UNIQUE INDEX ix_mv_dashboard_stats_id ON mv_dashboard_stats (id);

-- First REFRESH — populate now so the first request after deploy isn't served an empty dashboard
REFRESH MATERIALIZED VIEW mv_dashboard_stats;
