<div align="center">

# 🎨 Kura Booru V2

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
- 🖼️ **瀑布流布局** — react-photo-album 服务端渲染，零 JS 首屏
- 🎨 **三态主题** — dark / light / auto 跟随系统
- ⚡ **SSR + Caddy 缓存** — 5 分钟 TTL，近静态性能，新图立即可见
- 🔄 **感知哈希去重** — phash 前缀桶索引，O(1) 查重
- 📦 **S3 通用存储** — Cloudflare R2 / MinIO / AWS S3，改 env 即切换
- 🖼️ **渐进加载** — blur → 缩略图 → 预览 → 原图

## 🏗️ 架构

```
Internet → Caddy (宿主机) → Docker 内部网络
  /*      → frontend:4321  (SSR, 缓存)
  /api/*  → backend:8000   (无缓存)
  /i/*    → S3 兼容存储    (直连代理)
  /bot/*  → bot:8080       (Telegram webhook)
```

| 组件 | 技术 | 说明 |
|---|---|---|
| Bot | aiogram 3.x | Webhook 模式 |
| Backend | FastAPI + SQLAlchemy 2.0 (async) + ARQ | REST API + 任务队列 |
| Frontend | Astro 5 (SSR) + React 19 | 瀑布流 + 分页 + 搜索 |
| Storage | S3 兼容 (R2/MinIO/AWS) | 通用抽象层 |
| DB | PostgreSQL 16+ | 主数据存储 |
| Cache/Queue | Redis 7.x | ARQ 队列 + Caddy 缓存 |
| Proxy | Caddy 2.x + Souin | HTTPS + 缓存 + 反代 |

## 🚀 快速开始

### 前提

- Docker + Docker Compose v2
- Caddy 2.x with Souin plugin（生产环境）

### 1. 配置环境变量

```bash
cp infra/.env.example .env
# 编辑 .env，填入真实值：
# - S3 凭证（R2 / MinIO / AWS S3）
# - Telegram Bot Token
# - 数据库密码
# - Pixiv 认证（如需）
```

### 2. 启动服务

```bash
# 生产环境
docker compose -f infra/docker-compose.yml up -d

# 开发环境（热重载）
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up
```

### 3. 初始化数据库

```bash
docker compose -f infra/docker-compose.yml exec backend alembic upgrade head
```

### 4. 配置 Caddy

将 `infra/caddy/Caddyfile` 复制到宿主机 `/etc/caddy/Caddyfile`，替换域名和 S3 代理地址：

```bash
# 设置 S3 代理上游（Caddy 读取环境变量）
export S3_PROXY_UPSTREAM=https://your-account.r2.cloudflarestorage.com
# 或 MinIO: export S3_PROXY_UPSTREAM=http://localhost:9000
```

### 5. 设置 Telegram Webhook

Bot 启动后自动设置 webhook。确保 `BOT_WEBHOOK_URL` 指向你的域名。

## 📁 项目结构

```
kura-booru-v2/
├── backend/              # FastAPI REST API + ARQ 任务
│   ├── app/
│   │   ├── api/          #   REST 路由 (posts, tags, search, tasks, webhook)
│   │   ├── models/       #   SQLAlchemy 模型 (Post, Tag, PostTag, TagAlias)
│   │   ├── schemas/      #   Pydantic 数据校验
│   │   ├── services/     #   业务逻辑 (S3, pipeline, phash, gallery-dl)
│   │   ├── source_extractors/  # 来源解析 (Pixiv, Twitter, Danbooru, 通用)
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
│   │   ├── layouts/       #   BaseLayout
│   │   ├── pages/         #   首页, 详情, 标签, 搜索
│   │   ├── lib/           #   API 客户端, 工具函数
│   │   └── styles/        #   Tailwind v4 + 主题
│   └── Dockerfile
├── infra/                # 基础设施配置
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   ├── caddy/Caddyfile
│   └── .env.example
├── .env                  # 实际配置（git-ignored）
├── CLAUDE.md             # AI 编码助手指南（详细架构 + API + 约束）
├── PLAN.md               # 详细项目计划
└── README.md
```

## 🔧 开发

### 本地运行（无 Docker）

```bash
# 后端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Bot
cd bot
pip install -r requirements.txt
python -m app.main

# 前端
cd frontend
npm install
npm run dev

# ARQ Worker
cd backend
arq app.tasks.worker.WorkerSettings
```

### 数据库迁移

```bash
cd backend
alembic upgrade head                                    # 应用所有迁移
alembic revision --autogenerate -m "description"        # 创建新迁移
```

## 📦 S3 存储配置

S3 层完全通用，只改 env vars 即可切换存储后端：

| 变量 | R2 (生产) | MinIO (开发) | AWS S3 |
|---|---|---|---|
| `S3_ENDPOINT` | `https://<id>.r2.cloudflarestorage.com` | `http://minio:9000` | `https://s3.<region>.amazonaws.com` |
| `S3_PROXY_UPSTREAM` | 同 `S3_ENDPOINT` | `http://localhost:9000` | 同 `S3_ENDPOINT` |
| `S3_REGION` | `auto` | `us-east-1` | `<region>` |

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
| GET | `/i/{bucket}/{key}` | S3 图片直连 |

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