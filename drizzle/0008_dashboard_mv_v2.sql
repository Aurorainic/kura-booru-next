-- M16: dashboard breakdown 移入物化视图 — source_breakdown / rating_breakdown
-- 不再每次请求全表 GROUP BY（原实现每次 ~50ms + 全表扫描 CPU）。
-- DROP + 重建（MV 结构变更必须 DROP；CONCURRENTLY 只支持 REFRESH）。
-- ponytail: 5-min refresh 节奏不变；jsonb 列由 PG 侧聚合，前端零改动。
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

-- First refresh — populate immediately so the first request after deploy
-- doesn't get an empty dashboard. (NOT EXISTS INSERT 会读未填充 MV 报错，
-- REFRESH 是标准填充方式；首次填充无并发读者，不需要 CONCURRENTLY。)
REFRESH MATERIALIZED VIEW mv_dashboard_stats;
