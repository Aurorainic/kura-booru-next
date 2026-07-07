<div align="center">

<img src="logo.svg" alt="Kura Booru" width="120" />

# Kura Booru Next

**个人二次元插图收藏与展示平台**

甩链接 → 自动下载 → 存 S3 → 浏览，一气呵成。

[![Node](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Nuxt](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&logoColor=white)](https://nuxt.com)
[![Docker](https://img.shields.io/badge/Docker_Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

![✨ AIGC生成](https://img.shields.io/badge/✨-AIGC生成-8B5CF6?style=flat-square)
![🧪 实验性](https://img.shields.io/badge/🧪-实验性项目-2563EB?style=flat-square)

</div>

---

## ✨ 特性

- 🔗 **甩链即存** — Telegram Bot 发链接，自动下载原图 + 元数据；也支持网页端批量导入
- 🧩 **浏览器扩展** — Pixiv 作品页一键导入按钮，实时显示导入状态
- 🏷️ **标签体系** — artist / character / copyright / general / meta 五类标签，支持别名
- 🔍 **标签搜索** — `tag1+tag2` 组合搜索，`-tag2` 排除，`rating:safe` 评级筛选
- 📄 **分页浏览** — safebooru 风格，URL 可分享，每页 20/40/100 可选
- 🔞 **内容评级** — safe/questionable/explicit 三级评级，访客只看 safe
- 🤖 **自动评级** — 配置标签→评级映射规则，含特定标签的插画自动升级评级
- ✨ **AI 标签分类** — 新图入库自动调用 AI 进行 5 类分类 + 中文翻译 + Danbooru 标准命名
- 📡 **导入实时反馈** — 网页端批量导入 SSE 实时推送处理进度
- 🔐 **管理后台** — 单管理员登录解锁 NSFW 可见性，单页标签式管理面板
- ⚙️ **站点设置** — DB 驱动配置（标题/描述/公告/Head 注入/基础设施），管理后台直接改，无需重启
- 🛠️ **维护模式** — 一键开启，非管理员访问重定向到维护提示页
- 📢 **公告横幅** — 顶部细横幅，多行轮播 + 超宽滚动，支持 Markdown
- 🎨 **三态主题** — dark / light / auto 跟随系统 + 自定义主题色（accent hue）
- 📦 **S3 通用存储** — Cloudflare R2 / MinIO / AWS S3，改 env 即切换

## 🚀 快速开始

1. **配置环境变量** — `cp infra/.env.example .env` 并填入真实值（详见 [部署文档](docs/deployment.md)）
2. **启动服务** — `cd infra && docker compose --env-file ../.env -f docker-compose.yml up -d`（生产需先在 `.env` 设 `KURA_IMAGE_TAG`；详见 [部署文档](docs/deployment.md)）
3. **初始化数据库** — `npx drizzle-kit push`
4. **配置反向代理（可选）** — 详见 [部署文档](docs/deployment.md)
5. **设置 Telegram Webhook** — Bot 启动时自动设置，确保 `SITE_URL` 正确

### 浏览器扩展工作流

1. 安装 Chromium 扩展（加载解压包或 CI artifact）
2. 在扩展设置中填入服务器地址和 API Key
3. 访问 Pixiv 作品页，点击右下角「导入到 Kura」按钮
4. 等待处理完成，按钮显示导入结果

## 📚 文档

| 文档 | 说明 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 架构、技术栈、数据模型、API |
| [docs/deployment.md](docs/deployment.md) | 部署配置、环境变量 |
| [docs/development.md](docs/development.md) | 本地开发指南 |
| [docs/operations.md](docs/operations.md) | 运维：构建、迁移、备份 |
| [docs/roadmap.md](docs/roadmap.md) | 路线图 |
| [CHANGELOG.md](CHANGELOG.md) | 版本历史 |

## 📜 License

MIT
