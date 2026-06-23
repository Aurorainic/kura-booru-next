# 路线图

## 待做功能

- [ ] 更多 extractor（Twitter 完整支持、Danbooru 元数据）
- [ ] 端到端测试
- [ ] SSR 缓存启用（需先解决 Vary: Cookie + 缓存 key 问题）
- [ ] 数据库定期备份 cron
- [ ] Admin 密码修改后旧 session 失效机制
- [ ] `random_post` 深分页优化（TABLESAMPLE 或随机 UUID，当前方案在 100K+ 行时会慢）
- [ ] `_ensure_tags` 并发安全（多个 worker 同时创建同名 tag 可能冲突）
- [ ] S3 client 连接错误重连（当前懒缓存 client 如遇断连不会自动重建）

## 已完成功能

- [x] S3 client 连接池复用（懒缓存单例）— v0.4.2
- [x] `random_post` 计数缓存（in-process TTL）— v0.4.2
- [x] `_ensure_tags` 批量查询（N+1 → 3 queries）— v0.4.2
- [x] Tag `post_count` 定时同步（ARQ cron）— v0.4.2
- [x] Cache-Control 策略（API + HTML）— v0.4.2
- [x] 网页端批量导入队列实时更新（SSE，对齐 Bot 体验）— v0.4.1
- [x] 详情页直接删除当前图片（管理员）— v0.4.1
- [x] Pixiv 多图帖子只抓第一张 — v0.4.1
- [x] AI Retag：5 类分类 + 中文翻译 + Danbooru 标准命名 — v0.4.0
- [x] 管理后台标签管理页（列表/编辑/合并/AI 重处理）— v0.4.0
- [x] PG18 + Redis8 迁移 — v0.3.0
- [x] phash 去重基础实现 — v0.3.0

## 长期愿景（v0.5+）

- 数据库定期备份 cron
- Twitter 完整 extractor
- 多管理员支持
- SSR 缓存启用（需先解决 Vary: Cookie）
- keyset pagination（深分页优化）
- Danbooru API 作为 AI 之前的查询层（`tag_knowledge.source='danbooru_api'`）
- Danbooru tag implications（3 万+ 条隐含关系）
