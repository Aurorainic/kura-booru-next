# 路线图

## 待做功能

- [ ] 更多 extractor（Twitter 完整支持、Danbooru 元数据）
- [ ] 去重机制完善（phash 前缀桶数据库索引优化）
- [ ] 性能优化（Redis 缓存热门查询）
- [ ] 端到端测试
- [ ] SSR 缓存启用（需先解决 Vary: Cookie + 缓存 key 问题）
- [ ] 监控与告警（Prometheus + Grafana）
- [ ] 自动化 CI/CD（Gitea Actions）
- [ ] 数据库定期备份 cron
- [ ] Admin 密码修改后旧 session 失效机制
- [ ] SSE/WebSocket 任务状态推送
- [ ] Tag `post_count` 自动同步（当前需要手动 SQL）
- [ ] `random_post` 查询优化（大表慢，考虑 TABLESAMPLE 或随机 UUID）
- [ ] `_ensure_tags` 批量查询（当前循环逐个 select，N+1 问题）
- [ ] S3 client 连接池复用（当前每次操作新建 client）

## 已知限制

- Tag `post_count` auto-sync (currently needs manual SQL)
- Twitter/Danbooru extractors need refinement
- phash dedup optimization
- No SSE/WebSocket for real-time import progress
- Bot `_confirmed_posts` uses Redis SETEX (survives restart but has 24h TTL; old entries expire)

## 长期愿景（v0.4+）

- 监控（Prometheus + Grafana）
- 自动化 CI/CD（Gitea Actions）
- 数据库定期备份 cron
- SSE/WebSocket 任务状态推送
- Twitter 完整 extractor
- 多管理员支持
- PG18 + Redis8 迁移
- SSR 缓存启用（需先解决 Vary: Cookie）
- keyset pagination（深分页优化）
