<div align="center">

# 🎨 Kura Booru Next

**个人二次元插图收藏与展示平台**

甩链接 → 自动下载 → 存 S3 → 浏览，一气呵成。

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![Node](https://img.shields.io/badge/Node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Astro](https://img.shields.io/badge/Astro-5-FF5D01?logo=astro&logoColor=white)](https://astro.build)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Docker](https://img.shields.io/badge/Docker_Compose-v2-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

</div>

---

## ✨ 特性

- 🔗 **甩链即存** — Telegram Bot 发链接，自动下载原图 + 元数据
- 🏷️ **标签体系** — artist / character / copyright / general / meta 五类标签，支持别名
- 🔍 **标签搜索** — `tag1+tag2` 组合搜索，`-tag2` 排除，自动补全
- 📄 **分页浏览** — safebooru 风格，URL 可分享，每页 20/40/100 可选
- 🖼️ **瀑布流布局** — CSS Grid 瀑布流，SSR 渲染，零 JS 首屏
- 🎨 **三态主题** — dark / light / auto 跟随系统
- ⚡ **SSR + Caddy 缓存** — 5 分钟 TTL，近静态性能，新图立即可见
- 🔄 **感知哈希去重** — phash 前缀桶索引，O(1) 查重
- 📦 **S3 通用存储** — Cloudflare R2 / MinIO / AWS S3，改 env 即切换

## 🏗️ 架构

```
Internet → Caddy (宿主机) → Docker 内部网络
  /*      → frontend:4321  (SSR, 缓存)
  /api/*  → backend:8000   (无缓存)
  /bot/*  → bot:8080       (Telegram webhook)

Images → S3/CDN 直连 (不经过 Caddy)
```

| 组件 | 技术 | 说明 |
|---|---|---|
| Bot | aiogram 3.x | Webhook 模式 |
| Backend | FastAPI + SQLAlchemy 2.0 (async) + ARQ | REST API + 任务队列 |
| Frontend | Astro 5 (SSR) + React 19 | 瀑布流 + 分页 + 搜索 |
| Storage | S3 兼容 (R2/MinIO/AWS) | 通用抽象层，图片直连 CDN |
| DB | PostgreSQL 16+ | 主数据存储 |
| Cache/Queue | Redis 7.x | ARQ 队列 |
| Proxy | Caddy 2.x | HTTPS + 反代 |

## 🚀 快速开始

### 前提

- Docker + Docker Compose v2
- Caddy 2.x（生产环境，宿主机运行）

### 1. 配置环境变量

```bash
cp infra/.env.example infra/.env
# 编辑 infra/.env，填入真实值
```

**生产环境必填变量：**

| 变量 | 说明 |
|---|---|
| `APP_URL` / `APP_DOMAIN` | 你的域名 |
| `SECRET_KEY` | 用 `python -c "import secrets; print(secrets.token_urlsafe(48))"` 生成 |
| `POSTGRES_PASSWORD` | 数据库密码 |
| `S3_ENDPOINT` / `S3_EXTERNAL_URL` | S3 存储地址（R2/MinIO/AWS S3） |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | S3 凭据 |
| `BOT_TOKEN` | Telegram Bot Token（@BotFather） |
| `BOT_WEBHOOK_URL` | `https://<域名>/bot/webhook` |
| `BOT_WEBHOOK_SECRET` | Webhook 验证密钥 |
| `BOT_ADMIN_IDS` | 允许使用的 Telegram 用户 ID |

运行环境变量校验：
```bash
cd infra && ./scripts/validate-env.sh prod
```

### 2. 启动服务

```bash
# 开发环境（含 MinIO + 热重载）
cd infra && docker compose -f docker-compose.dev.yml up

# 生产环境（需要外部 S3）
cd infra && docker compose up -d
```

### 3. 初始化数据库

```bash
cd infra && docker compose exec backend alembic upgrade head
```

### 4. 配置 Caddy

将 `infra/caddy/Caddyfile` 部署到宿主机 Caddy：

```bash
# Caddy 使用环境变量（从 .env 或系统环境加载）
cp infra/caddy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddyfile 中的变量通过 `{$VAR}` 语法读取：
- `{$APP_DOMAIN}` — 你的域名
- `{$BACKEND_HOST}:{$BACKEND_PORT}` — 后端地址
- `{$BOT_HOST}:{$BOT_PORT}` — Bot 地址
- `{$FRONTEND_HOST}:{$FRONTEND_PORT}` — 前端地址

### 5. 设置 Telegram Webhook

Bot 启动后自动设置 webhook。确保 `BOT_WEBHOOK_URL` 指向你的域名。

## 📁 项目结构

```
kura-booru-next/
├── backend/              # FastAPI REST API + ARQ 任务
│   ├── app/
│   │   ├── api/          #   REST 路由 + constants
│   │   ├── models/       #   SQLAlchemy 模型
│   │   ├── schemas/      #   Pydantic 数据校验
│   │   ├── services/     #   业务逻辑 (S3, pipeline, phash, gallery-dl)
│   │   ├── source_extractors/  # 来源解析 (Pixiv, Twitter, Danbooru)
│   │   └── tasks/        #   ARQ 任务 (process_image, worker)
│   ├── alembic/          #   数据库迁移
│   └── Dockerfile
├── bot/                  # aiogram 3 Telegram Bot
│   ├── app/
│   │   ├── handlers/     #   /start, /save, /search, /info, URL 检测
│   │   └── services/     #   ARQ 客户端, Backend API 客户端
│   └── Dockerfile
├── frontend/             # Astro SSR + React Islands
│   ├── src/
│   │   ├── components/   #   ThemeToggle, Pagination, PhotoAlbum, SearchBar
│   │   ├── layouts/      #   BaseLayout
│   │   ├── pages/        #   首页, 详情, 标签, 搜索
│   │   ├── lib/          #   API 客户端, 分页工具, 标签颜色
│   │   └── styles/       #   Tailwind v4 + 主题
│   └── Dockerfile
├── infra/                # 基础设施配置
│   ├── docker-compose.yml      # 生产环境
│   ├── docker-compose.dev.yml  # 开发环境（独立）
│   ├── caddy/Caddyfile         # 反代配置（域名/端口变量化）
│   ├── scripts/
│   │   ├── migrate-db.sh       # 开发→生产数据库迁移
│   │   └── validate-env.sh     # 环境变量校验
│   ├── dumps/                  # 数据库 dump（git-ignored）
│   └── .env.example            # 环境变量模板
├── AUDIT_v0.1.0.md       # 代码审计报告
├── CLAUDE.md             # AI 编码助手指南
├── PLAN.md               # 详细项目计划
└── README.md
```

## 🔧 开发

### 环境变量校验

```bash
# 检查开发环境配置
cd infra && ./scripts/validate-env.sh dev

# 检查生产环境配置（严格）
cd infra && ./scripts/validate-env.sh prod
```

### 数据库迁移

```bash
cd backend
alembic upgrade head                                    # 应用所有迁移
alembic revision --autogenerate -m "description"        # 创建新迁移
```

### 开发→生产数据库迁移

```bash
# 仅导出开发数据库
cd infra && ./scripts/migrate-db.sh --dump-only

# 导入到生产环境
cd infra && ./scripts/migrate-db.sh --import-only dumps/backup-xxx.sql

# 交互式（导出→确认→导入）
cd infra && ./scripts/migrate-db.sh
```

## 📦 S3 存储配置

S3 层完全通用，只改 env vars 即可切换存储后端：

| 变量 | R2 (生产) | MinIO (开发) | AWS S3 |
|---|---|---|---|
| `S3_ENDPOINT` | `https://<id>.r2.cloudflarestorage.com` | `http://minio:9000` | `https://s3.<region>.amazonaws.com` |
| `S3_EXTERNAL_URL` | `https://images.your-domain.com` | `http://localhost:9000/kura-booru` | `https://<bucket>.s3.<region>.amazonaws.com` |
| `S3_REGION` | `auto` | `us-east-1` | `<region>` |
| `PUBLIC_S3_EXTERNAL_URL` | 同 `S3_EXTERNAL_URL` | 同 `S3_EXTERNAL_URL` | 同 `S3_EXTERNAL_URL` |

图片通过 S3/CDN URL 直接访问，不经过 Caddy 代理。

## 📡 API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/posts?page=1&per_page=40` | 分页帖子列表 |
| GET | `/api/posts/{id}` | 帖子详情（含标签） |
| GET | `/api/posts/random` | 随机帖子 |
| GET | `/api/posts/by-source?source_site=pixiv&source_id=123` | 按来源查找 |
| GET | `/api/tags?category=artist&sort=count` | 标签列表 |
| GET | `/api/tags/{name}` | 标签详情 |
| GET | `/api/tags/autocomplete?q=prefix` | 标签自动补全 |
| GET | `/api/search?q=tag1+tag2` | 标签搜索（支持 `-` 排除） |
| POST | `/api/tasks/` | 创建图片处理任务 |
| POST | `/api/rebuild/` | 清除 Caddy 缓存 |

## 🤖 Telegram Bot 指令

| 指令 | 说明 |
|---|---|
| `/start` | 欢迎消息和使用说明 |
| `/save <url>` | 保存图片 |
| `/search <tags>` | 搜索帖子 |
| `/info <url>` | 查看帖子详情 |
| 直接发 URL | 自动识别并保存 |

支持 Pixiv、Twitter/X、Danbooru 链接，未知 URL 自动 fallback 到通用下载。

## 📜 License

MIT
