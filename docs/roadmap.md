# 路线图

## 待做功能

- [ ] 更多 extractor（Twitter 完整支持、Danbooru 元数据）
- [ ] 端到端测试
- [ ] SSR 缓存启用（需先解决 Vary: Cookie + 缓存 key 问题）
- [ ] 数据库定期备份 cron
- [ ] `random_post` 深分页优化（TABLESAMPLE 或随机 UUID，当前方案在 100K+ 行时会慢）

## 已完成功能

- [x] 管理后台仪表盘（4 张概览卡 + 来源/评级分布 + 热门标签 TOP 10 + 最新作品 6 张）— v0.6.3
- [x] 标签合并重写（`post_count` COUNT(*) 重新计算 + 单事务原子提交 + 并发合并行锁）— v0.6.3
- [x] 标签 UUID 复制浮泡（hover 显示 + 点击复制 + 降级到 textarea）— v0.6.3
- [x] ClientRouter View Transitions（SPA-like 页面切换 + transition:persist 持久化 footer/公告/主题/配色/移动菜单）— v0.6.2
- [x] Bot /random 和 /stats 命令（随机图片 + 仪表盘统计）— v0.6.2
- [x] Settings cache TTL 优化（前端中间件 10s + 后端 Redis 60s）— v0.6.2
- [x] 响应式布局修复（触控目标、safe-area、标签浮层适配）— v0.6.2
- [x] 站点设置系统（DB 驱动 key-value 配置 + 管理后台 UI）— v0.6.0
- [x] 公告横幅（顶部细横幅，多行轮播 + 超宽滚动 + Markdown）— v0.6.0
- [x] 维护模式（非管理员拦截 + 维护提示页）— v0.6.0
- [x] 主题色选择器（accent hue Cookie 持久化，SSR anti-flash）— v0.6.0
- [x] 管理后台标签页整合（单页 + 子标签）— v0.6.0
- [x] Chromium 浏览器扩展（Pixiv 作品页一键导入）— v0.5.0
- [x] 密码修改后 Session 失效（`password_changed_at` + Redis 缓存）— v0.5.0

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
- 浏览器扩展支持更多站点（Twitter、Danbooru）
- Chrome Web Store 发布（需审核流程）
