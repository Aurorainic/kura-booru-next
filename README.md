<div align="center">

<img src="logo.svg" alt="Kura Booru" width="120" />

# Kura Booru Next

**个人二次元插图收藏与展示平台**

甩链接 → 自动下载 → 存 S3 → 浏览，一气呵成。

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![Node](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Astro](https://img.shields.io/badge/Astro-5-FF5D01?logo=astro&logoColor=white)](https://astro.build)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Docker](https://img.shields.io/badge/Docker_Compose-v2-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

![✨ AIGC生成](https://img.shields.io/badge/✨-AIGC生成-8B5CF6?style=flat-square)
![🧪 实验性](https://img.shields.io/badge/🧪-实验性项目-2563EB?style=flat-square)

</div>

---

## ✨ 特性

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

## 🚀 快速开始

1. **配置环境变量** — `cp infra/.env.example .env` 并填入真实值（详见 [部署文档](docs/deployment.md)）
2. **启动服务** — `cd infra && docker compose -f docker-compose.dev.yml up`
3. **初始化数据库** — `docker compose exec backend alembic upgrade head`
4. **配置 Caddy** — 详见 [部署文档](docs/deployment.md)
5. **设置 Telegram Webhook** — 详见 [部署文档](docs/deployment.md)

## 📚 文档

| 文档 | 说明 |
|---|---|
| [docs/README.md](docs/README.md) | 文档入口 |
| [docs/architecture.md](docs/architecture.md) | 架构、技术栈、数据模型、API |
| [docs/deployment.md](docs/deployment.md) | 部署配置、环境变量 |
| [docs/development.md](docs/development.md) | 本地开发指南 |
| [docs/operations.md](docs/operations.md) | 运维：构建、迁移、备份 |
| [docs/roadmap.md](docs/roadmap.md) | 路线图 |
| [CHANGELOG.md](CHANGELOG.md) | 版本历史 |

## 📜 License

MIT
