# 路线图

## 待做功能

- [ ] sharp 替代 Pillow 缩略图生成（sidecar 当前使用 Pillow，计划迁移到 sharp 以获得 3-5x 性能提升）
- [ ] LQIP 生成（sidecar 生成 20×20px 模糊占位图，嵌入 API 响应 `lqip` 字段）
- [ ] 图片 modal pan/zoom（滚轮缩放 + 拖拽平移 + 双指 pinch）
- [ ] 键盘导航（J/K 翻页，/ 聚焦搜索，G+T 跳转标签）
- [ ] 滚动位置记忆（详情页返回首页时恢复滚动位置）
- [ ] 最近搜索（localStorage 5 条历史）
- [ ] 相关标签（标签详情页展示共现 Top 10）
- [ ] 端到端测试
- [ ] 数据库定期备份 cron
- [ ] `random_post` 深分页优化（TABLESAMPLE 或随机 UUID）
- [ ] SSR 缓存启用（需先解决 Vary: Cookie + 缓存 key 问题）

## 已完成功能

###  架构迁移 (TypeScript 全栈)

- [x] **Nuxt 4 + Nitro 单进程** — SSR + REST API + Bot webhook 合并为单个 Node 进程，消除 HTTP hop — v0.7.0-pre1
- [x] **Drizzle ORM** — 替代 SQLAlchemy，编译时类型推断，SQL-first 查询构建 — v0.7.0-pre1
- [x] **grammy Bot** — 替代 aiogram，进程内运行，直接调用服务函数 — v0.7.0-pre1
- [x] **Python sidecar** — gallery-dl + imagehash 通过 Redis 队列（LPUSH/BRPOP）— v0.7.0-pre1
- [x] **Meilisearch 删除** — pg_trgm 覆盖模糊搜索，节省 ~200MB RAM — v0.7.0-pre1
- [x] **HMAC 签名 cookie** — 替代 itsdangerous，Node.js crypto.createHmac — v0.7.0-pre1
- [x] **Admin 自动播种** — `seed-admin.ts` 插件从环境变量自动创建管理员 — v0.7.0-pre1
- [x] **API 序列化层** — Drizzle camelCase → snake_case API 响应，phash 永不暴露 — v0.7.0-pre1
- [x] **容器从 7 减到 4** — 内存 ~680MB → ~350MB（-48%）— v0.7.0-pre1

### v1 功能（已迁移到）

- [x] 管理后台仪表盘（4 张概览卡 + 来源/评级分布 + 热门标签 TOP 10 + 最新作品 6 张）— v0.6.3
- [x] 标签合并重写（`post_count` COUNT(*) 重新计算 + 单事务原子提交）— v0.6.3
- [x] Bot /random 和 /stats 命令 — v0.6.2
- [x] Settings cache TTL 优化（中间件 10s + Redis 缓存）— v0.6.2
- [x] 站点设置系统（DB 驱动 key-value 配置 + 管理后台 UI）— v0.6.0
- [x] 公告横幅（顶部细横幅，多行轮播 + 超宽滚动 + Markdown + 图标+文字显著提示）— v0.6.0
- [x] 维护模式（非管理员拦截 + 维护提示页）— v0.6.0
- [x] 主题色选择器（accent hue Cookie 持久化，SSR anti-flash）— v0.6.0
- [x] 管理后台标签页整合（单页 + 子标签）— v0.6.0
- [x] Chromium 浏览器扩展（Pixiv 作品页一键导入）— v0.5.0
- [x] 密码修改后 Session 失效（`password_changed_at` + Redis 缓存 password_epoch）— v0.5.0
- [x] S3 client 连接池复用（懒缓存单例）— v0.4.2
- [x] AI Retag：5 类分类 + 中文翻译 + Danbooru 标准命名 — v0.4.0
- [x] phash 去重基础实现 — v0.3.0

## 长期愿景

- sharp 替代 Pillow（缩略图生成 3-5x 提速）
- Twitter 完整 extractor
- 多管理员支持
- keyset pagination（深分页优化）
- Danbooru tag implications（3 万+ 条隐含关系）
- 浏览器扩展支持更多站点（Twitter、Danbooru）
- Chrome Web Store 发布
