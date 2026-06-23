# 路线图

## 待做功能

- [ ] 更多 extractor（Twitter 完整支持、Danbooru 元数据）
- [ ] 去重机制完善（phash 前缀桶数据库索引优化）
- [ ] 性能优化（Redis 缓存热门查询）
- [ ] 端到端测试
- [ ] SSR 缓存启用（需先解决 Vary: Cookie + 缓存 key 问题）
- [ ] 数据库定期备份 cron
- [ ] Admin 密码修改后旧 session 失效机制
- [ ] Tag `post_count` 自动同步（当前需要手动 SQL）
- [ ] `random_post` 查询优化（大表慢，考虑 TABLESAMPLE 或随机 UUID）
- [ ] `_ensure_tags` 批量查询（当前循环逐个 select，N+1 问题）
- [ ] S3 client 连接池复用（当前每次操作新建 client）

## 已完成功能

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
