# Kura Booru V2 — 项目计划（修订版）

## Context

个人用二次元插图收藏与展示平台。核心场景：Telegram Bot 甩链接 → 自动下载原图 → 存 S3 → Web 展示浏览。
学习 safebooru 的优点（标签体系、分页浏览、快速加载），但视觉要现代化。

**v1 教训**：v1 项目已有完整代码 + 架构审计（P0/P1 共 244 项发现），v2 必须从规划就避开同样的坑。

**v2 核心修正**：
- ~~SSG 静态生成~~ → **SSR + Caddy 缓存**（SSG 无法增量重建，新图要等全站重建才能看到）
- ~~Caddy 在 Docker Compose 里~~ → **Caddy 在宿主机**，Docker 服务通过专用内网互联
- 前端分页而非无限滚动，角落有每页数量切换
- 图片上限 6MB

---

## 技术栈

| 层 | 技术 | 版本 | 用途 |
|---|---|---|---|
| **Bot** | aiogram | 3.x | Telegram Bot（webhook 模式） |
| **后端** | FastAPI | 0.110+ | REST API |
| | SQLAlchemy | 2.0+ (async) | ORM |
| | Alembic | latest | 数据库迁移 |
| | Pydantic | 2.x | 数据校验 + Settings |
| | ARQ | latest | 异步任务队列（Redis 驱动） |
| | Pillow | latest | 缩略图生成 |
| | imagehash | latest | 感知哈希去重 |
| | gallery-dl | latest | 统一图片下载引擎（Python API 调用） |
| | aiobotocore | latest | 异步 S3 客户端 |
| | aiohttp | latest | HTTP 请求 |
| **前端** | Astro | 5.x | **SSR 模式**（非 SSG） |
| | React | 19.x | 交互组件 Islands |
| | react-photo-album | latest | Masonry 瀑布流（server 组件零 JS） |
| | Tailwind CSS | v4 | 样式 |
| | shadcn/ui | latest | 基础 UI 组件 |
| | TanStack Query | v5 | 客户端数据缓存 |
| **存储** | S3 兼容协议 | — | 对象存储（MinIO/R2/任意，抽象层通吃） |
| **数据库** | PostgreSQL | 16+ | 主数据存储 |
| **缓存/队列** | Redis | 7.x | ARQ 队列 + Caddy 缓存后端 + Bot 状态 |
| **反代** | Caddy | 2.x | 宿主机运行，HTTPS + 缓存 + 反代 |
| | Souin 插件 | latest | Caddy HTTP 缓存（替代全站 SSG） |
| **部署** | Docker Compose | v2 | 编排后端/Bot/前端/数据库/Redis/MinIO |

---

## 为什么是 SSR + Caddy 缓存而不是 SSG？

| 对比项 | SSG（原方案） | SSR + Caddy 缓存（修正方案） |
|---|---|---|
| 新图片可见性 | 等重建完成（30s~15min） | 立即可见 |
| 缓存命中性能 | ~3ms（静态文件） | ~5-8ms（Caddy 缓存） |
| 运维复杂度 | 需要构建管线+部署流程 | 只是多跑一个 Node 进程 |
| 构建时间随内容增长 | O(n)，最终不可接受 | 不存在构建步骤 |
| 搜索/分页等动态页面 | 无法预生成所有组合 | 天然支持 |
| 个人站点感知差异 | 略快 | 几乎无差别 |

**Caddy Souin 缓存策略**：
- 默认 TTL 5 分钟，stale 10 分钟（stale-while-revalidate）
- Bot 收藏新图后可选发 cache purge 请求到 Caddy
- 图片等静态资源通过 Caddy 直连 S3，不走后端

---

## 架构图

```
Internet
   │
   ▼
┌──────────────────┐
│  Caddy (宿主机)   │  ← HTTPS 终止 + 缓存 + 反代
│  + Souin 缓存     │
└──┬────────────┬──┘
   │            │
   │ /api/*     │ /*
   │            │
   ▼            ▼
┌──────────────────────────────────────┐
│          Docker 内部网络              │
│                                      │
│  ┌──────────┐  ┌──────────┐         │
│  │ Backend  │  │ Frontend │         │
│  │ FastAPI  │  │ Astro SSR│         │
│  │ :8000    │  │ :4321    │         │
│  └────┬─────┘  └──────────┘         │
│       │                              │
│  ┌────▼────┐  ┌───────┐  ┌─────┐   │
│  │ Bot     │  │ Redis │  │ PG  │   │
│  │ aiogram │  │ :6379  │  │16+  │   │
│  │ :8080   │  └───────┘  └─────┘   │
│  └────┬────┘                         │
│       │                              │
│  ┌────▼────┐                         │
│  │ MinIO   │                         │
│  │ :9000   │                         │
│  └─────────┘                         │
└──────────────────────────────────────┘
```

**Caddy 反代规则**：
- `domain.com/*` → `frontend:4321`（带缓存）
- `domain.com/api/*` → `backend:8000`（不缓存）
- `domain.com/i/*` → `minio:9000`（直连 S3，零后端开销）
- `domain.com/bot/webhook` → `bot:8080`（Telegram webhook）

---

## 环境变量

所有配置通过 `.env` 文件管理，`.env.example` 进 git（占位值），`.env` 不进 git。

```env
# === 应用 ===
APP_URL=https://kura.example.com
API_URL=https://api.kura.example.com
SECRET_KEY=change-me-in-production

# === S3 存储 ===
S3_ENDPOINT=http://minio:9000              # Docker 内部地址
S3_EXTERNAL_URL=https://kura.example.com/i  # 外部访问地址（Caddy 反代）
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET_NAME=kura-booru
S3_REGION=us-east-1

# === 数据库 ===
DATABASE_URL=postgresql+asyncpg://kura:password@postgres:5432/kurabooru

# === Redis ===
REDIS_URL=redis://redis:6379/0

# === Telegram Bot ===
BOT_TOKEN=123456:ABC-xxx
BOT_WEBHOOK_URL=https://kura.example.com/bot/webhook
BOT_WEBHOOK_SECRET=your-secret-token
BOT_ADMIN_IDS=12345,67890

# === 图片处理 ===
MAX_IMAGE_SIZE=6291456                    # 6MB in bytes
THUMB_SIZE=150x150
PREVIEW_SIZE=850x850

# === gallery-dl 认证 ===
PIXIV_REFRESH_TOKEN=xxx
PIXIV_PHPSESSID=xxx                       # R-18 内容必需
# TWITTER_AUTH_TOKEN=xxx                   # 如需 Twitter
# TWITTER_CT0=xxx

# === 前端 ===
PUBLIC_API_URL=https://kura.example.com/api
```

gallery-dl 的认证不在 `.env` 里直接用——Backend 启动时通过 `gallery_dl.config.set()` 从环境变量注入到 gallery-dl 配置。

---

## 数据模型

### Post
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| s3_key | String | S3 原图路径 |
| thumb_key | String | S3 缩略图路径（150x150） |
| preview_key | String | S3 预览图路径（850x850） |
| source_url | String | 原始链接 |
| source_site | Enum | pixiv / twitter / danbooru / other |
| source_id | String | 来源站点的作品 ID |
| width | Integer | 原图宽 |
| height | Integer | 原图高 |
| file_size | Integer | 文件大小 bytes |
| mime_type | String | image/png 等 |
| phash | String(64) | 感知哈希（去重用） |
| title | String | 作品标题 |
| description | Text | 作品描述 |
| created_at | DateTime | 入库时间 |

### Tag
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| name | String | 标签名（唯一） |
| category | Enum | artist / character / copyright / general / meta |
| post_count | Integer | 冗余计数 |

### PostTag (多对多关联)
| 字段 | 类型 |
|---|---|
| post_id | UUID (FK) |
| tag_id | UUID (FK) |

### TagAlias (标签别名)
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| alias_name | String | 别名（唯一） |
| tag_id | UUID (FK) | 指向正式标签 |

---

## 核心流程：甩链即存

```
用户发链接到 Bot
    → Bot 用 aiogram 消息解析提取 URL
    → 识别 source_site + source_id
    → 发送 ARQ 任务到后台队列
    → Bot 回复 "⏳ 正在下载..."

ARQ Worker:
    → gallery-dl Python API 下载原图 + infojson 元数据
    → 下载前 HEAD 检查 Content-Length，超过 6MB 拒绝
    → 计算感知哈希，检查是否重复
    → Pillow 生成缩略图（thumb / preview）
    → 上传原图 + 缩略图 + 预览图到 S3
    → 写入数据库（Post + Tags from infojson）
    → 可选：purge Caddy 缓存
    → 通知 Bot → Bot 编辑消息 "✅ 已收藏"

失败路径：
    → 下载失败 → Bot 回复 "❌ 下载失败：{原因}"
    → 图片超 6MB → Bot 回复 "❌ 文件过大（{size}MB），上限 6MB"
    → 重复 → Bot 回复 "⚠️ 已存在：{链接}"
```

### gallery-dl 集成要点

gallery-dl 作为 Python 库调用（不是 subprocess），关键注意：

1. **同步阻塞**：`DownloadJob.run()` 是同步的，在 async 代码中用 `ThreadPoolExecutor` 包装
2. **全局配置单例**：`gallery_dl.config` 是模块级状态，启动时从环境变量注入一次，不在并发请求中修改
3. **双认证**：Pixiv 需要 refresh-token + PHPSESSID，都要从环境变量注入
4. **限速**：设置 `"sleep-request": [0.5, 1.5]`，`"parallel": 1` 避免 IP 封锁
5. **infojson**：用 `--write-infojson` 导出完整元数据（标题、标签、作者等）
6. **版本固定**：pin gallery-dl 版本，定期手动更新

---

## 来源解析策略

### 第一层：Bot 快速提取（aiogram）
- 消息中检测 URL → 正则匹配已知站点格式
- 提取 source_site + source_id
- 利用 Telegram link preview 获取标题作为 fallback

### 第二层：gallery-dl 完整下载（ARQ Worker）
- gallery-dl 统一下载引擎，每个 URL 调用 `DownloadJob`
- `--write-infojson` 导出元数据 → 自动提取标签
- 不支持的 URL fallback 到通用 HTTP 下载

### 第三层：后处理
- 感知哈希去重
- Pillow 生成缩略图 → 上传 S3
- 写入数据库 → 可选 purge 缓存

---

## 前端设计：SSR + 分页 + Caddy 缓存

### 为什么分页而不是无限滚动？

1. 像 safebooru，页面边界明确，可分享 URL
2. 浏览器友好，不无限吃内存
3. 分页 = 请求一个 URL = Caddy 缓存命中 = 极快
4. URL 格式：`/posts/page/3?per_page=40`

### 分页设计

- **页面底部**：传统分页导航 `< 1 2 3 ... 50 >`
- **角落控件**：每页数量切换器，选项：`20 | 40 | 100`（默认 40）
- 切换每页数量时跳转到第 1 页

### 布局

- **首页**：Masonry 瀑布流（react-photo-album server 组件，零 JS） + 分页 + 每页数量切换
- **标签页**：标签云（分类着色）+ 热门标签列表 + 分页
- **详情页**：大图 + 侧栏标签列表 + 来源链接 + 相邻导航
- **搜索页**：搜索栏 + 标签自动补全 + 结果分页（客户端 Island）

### 视觉风格

- **色调**：淡青 (#7DD3C0) → 薄荷绿 (#A7F3D0) → 天蓝 (#BAE6FD) 渐变
- **三态主题**：auto / dark / light 单按钮切换
  - Dark：深灰底 (#0F1117) + 淡青 accent
  - Light：白底 (#FAFBFC) + 淡青渐变 accent
  - Auto：跟随系统
- **卡片**：圆角 + 柔和阴影 + hover 上浮 + 标签预览浮现
- **图片渐进加载**：blur placeholder → 缩略图 → 预览图 → 点击看原图
- **响应式**：移动端 2 列，平板 3 列，桌面 4-5 列

### react-photo-album 集成策略

**关键**：使用 `react-photo-album/server` 的 Server Component 渲染瀑布流布局，零 JS。

- 列表页（首页、标签页、搜索结果）：Server Component 渲染，纯 HTML，不加载 React runtime
- 搜索栏、主题切换、分页切换：React Islands（`client:visible` 或 `client:load`）
- 详情页大图：可点击放大 → Lightbox Island（按需加载）

这样列表页的首屏完全是 HTML + CSS，性能接近静态站。

---

## API 设计

### Posts
- `GET /api/posts?page=1&per_page=40` — 分页列表
- `GET /api/posts/{id}` — 详情（含标签）
- `GET /api/posts/random` — 随机一张

### Tags
- `GET /api/tags?category=character&sort=count` — 标签列表
- `GET /api/tags/{name}` — 标签详情（含帖子）

### Search
- `GET /api/search?q=tag1+tag2&page=1&per_page=40` — 标签组合搜索
- 支持排除：`q=tag1+-tag2`

### 图片（Caddy 直连 S3）
- `GET /i/{s3_key}` — 零后端开销

### Webhook
- `POST /api/rebuild` — 可选，触发 Caddy 缓存 purge

---

## 从 v1 审计中学到的教训

v1 的架构审计发现了 P0/P1 问题，v2 必须避免：

| v1 问题 | v2 对策 |
|---|---|
| 缩略图无法显示（S3 key 错误） | S3 路径规范化 + 上传后验证 URL 可访问 |
| Dockerfile 构建失败 | 多阶段构建 + 固定基础镜像版本 |
| S3 大文件 OOM | 6MB 上限 + 流式上传而非内存缓冲 |
| Bot 认证不一致 | 统一 admin_ids 环境变量 + 中间件校验 |
| 去重 O(n) 扫描 | phash 前缀桶索引 + 数据库索引 |
| 缺少数据库索引 | 迁移中显式创建所有必要索引 |
| 前端缺少 QueryClientProvider | 从 v1 一开始就正确配置 TanStack Query |
| SSR 模式但无缓存 | Caddy Souin 缓存层 |

---

## 开发阶段

### Phase 1：基础设施 + 后端核心
1. Docker Compose（不含 Caddy）+ MinIO + PostgreSQL + Redis
2. 数据模型 + Alembic 迁移 + 所有索引
3. S3 存储抽象层（路径规范化 + 上传验证）
4. 图片处理管线（下载、6MB 校验、缩略图、phash）
5. ARQ 任务队列 + gallery-dl Python API 集成
6. API routes（posts、tags、search、分页）+ Pydantic Settings
7. Caddyfile（宿主机）+ Souin 缓存配置

### Phase 2：Telegram Bot
1. Bot 入口 + webhook（aiogram 3 aiohttp server）
2. URL 检测 + 来源识别
3. ARQ 任务对接
4. !save / !search / !info /start 指令
5. gallery-dl 认证管理

### Phase 3：前端展示
1. Astro SSR 项目搭建 + 主题系统 + 三态切换
2. react-photo-album/server 瀑布流（零 JS）
3. 分页组件 + 每页数量切换器
4. 首页（分页浏览）
5. 标签浏览页
6. 详情页
7. 搜索功能（客户端 Island）
8. Caddy 缓存 purge 对接

### Phase 4：完善
1. 更多 extractor（Twitter、Danbooru、通用）
2. 去重机制完善（phash 前缀桶）
3. 性能优化（Redis 缓存热门查询）
4. 部署文档

---

## 验证方式

1. **Bot 流程**：发 Pixiv 链接 → 收到"正在下载" → 收到"已收藏" → 前端立即可见
2. **前端性能**：Caddy 缓存命中时 TTFB < 10ms，列表页零 JS 首屏
3. **分页**：切换页码和每页数量正常，URL 可分享
4. **S3 直连**：`/i/{key}` 不经后端，Caddy 直接返回 S3 内容
5. **6MB 限制**：超大图被拒绝，Bot 回复具体原因
6. **去重**：相同图片重复发送时 Bot 提示已存在
7. **明暗主题**：三态切换正常，系统偏好自动匹配