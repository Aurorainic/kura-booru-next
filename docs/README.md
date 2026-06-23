# Kura Booru Next 文档

个人二次元插图收藏与展示平台。核心场景：Telegram Bot 甩链接 → 自动下载原图 → 存 S3 → Web 展示浏览。

## 特性

- 🔗 **甩链即存** — Telegram Bot 发链接，自动下载原图 + 元数据；也支持网页端批量导入
- 🏷️ **标签体系** — artist / character / copyright / general / meta 五类标签，支持别名
- 🔍 **标签搜索** — `tag1+tag2` 组合搜索，`-tag2` 排除，`rating:safe` 评级筛选
- 📄 **分页浏览** — safebooru 风格，URL 可分享，每页 20/40/100 可选
- 🔞 **内容评级** — safe/questionable/explicit 三级评级，访客只看 safe
- 🤖 **自动评级** — 配置标签→评级映射规则，含特定标签的插画自动升级评级
- ✨ **AI 标签分类** — 新图入库自动调用 AI 进行 5 类分类 + 中文翻译 + Danbooru 标准命名
- 📡 **导入实时反馈** — 网页端批量导入 SSE 实时推送处理进度
- 🔐 **管理后台** — 单管理员登录解锁 NSFW 可见性
- 🎨 **三态主题** — dark / light / auto 跟随系统
- 📦 **S3 通用存储** — Cloudflare R2 / MinIO / AWS S3，改 env 即切换

## 30 秒上手

1. **配置环境变量** — `cp infra/.env.example .env` 并填入真实值
2. **启动服务** — `cd infra && docker compose -f docker-compose.dev.yml up`
3. **初始化数据库** — `docker compose exec backend alembic upgrade head`
4. **配置 Caddy** — 详见 [部署文档](deployment.md)
5. **设置 Telegram Webhook** — Bot 启动后自动设置，详见 [部署文档](deployment.md)

## 文档索引

| 文档 | 内容 |
|---|---|
| [architecture.md](architecture.md) | 架构图、技术栈、数据模型、API 端点、认证设计 |
| [deployment.md](deployment.md) | 部署配置：环境变量、S3 配置、Caddy、Docker Compose |
| [development.md](development.md) | 本地开发：dev compose、迁移、调试、测试验证 |
| [operations.md](operations.md) | 运维：Docker 镜像管理、构建脚本、China build notes |
| [roadmap.md](roadmap.md) | 待做功能路线图 |
| [AI_Retag_internals.md](AI_Retag_internals.md) | AI 标签分类：内部架构、已知问题、调试指南 |
| [../CHANGELOG.md](../CHANGELOG.md) | 版本变更历史 |
