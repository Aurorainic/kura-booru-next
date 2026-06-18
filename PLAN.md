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
- **S3 层完全通用** — 支持 R2 / MinIO / AWS S3 / 任意 S3 兼容存储，只改 env vars

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
| **存储** | S3 兼容协议 | — | 对象存储（R2/MinIO/AWS S3 通用） |
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

---

## 架构图

```
Internet
   │
   ▼
┌──────────────────┐
│  Caddy (宿主机)   │  ← HTTPS 终止 + 缓存 + 反代
│  + Souin 缓存     │
└──┬────────┬───────┘
   │        │
   │ /i/*   │ 其余
   │        │
   ▼        ▼
 S3 兼容    ┌──────────────────────────────────────┐
 存储       │          Docker 内部网络              │
(R2/MinIO)  │                                      │
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
            │  ┌────▼────┐  (MinIO only in dev)     │
            │  │ MinIO   │                          │
            │  │ :9000   │                          │
            │  └─────────┘                          │
            └──────────────────────────────────────┘
```

**Caddy 反代规则**：
- `domain.com/*` → `frontend:4321`（带缓存）
- `domain.com/api/*` → `backend:8000`（不缓存）
- `domain.com/i/*` → S3 兼容存储（通用代理，通过 `$S3_PROXY_UPSTREAM` 环境变量切换）
- `domain.com/bot/webhook` → `bot:8080`（Telegram webhook）

**S3 层通用设计**：
- 后端上传走 `S3_ENDPOINT`（内网直连 S3 API）
- 浏览器访问走 `S3_EXTERNAL_URL`（Caddy 代理 `/i/*` → `S3_PROXY_UPSTREAM`）
- 三个变量独立配置，适配 R2 / MinIO / AWS S3 / 任意兼容存储

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
| title | String | 作品标题（可空） |
| description | Text | 作品描述（可空） |
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

## API 设计

### Posts
- `GET /api/posts?page=1&per_page=40` — 分页列表
- `GET /api/posts/{id}` — 详情（含标签）
- `GET /api/posts/random` — 随机一张
- `GET /api/posts/by-source?source_site=pixiv&source_id=123` — 按来源查找

### Tags
- `GET /api/tags?category=artist&sort=count` — 标签列表
- `GET /api/tags/{name}` — 标签详情
- `GET /api/tags/autocomplete?q=prefix` — 标签名自动补全

### Search
- `GET /api/search?q=tag1+tag2&page=1&per_page=40` — 标签组合搜索
- 支持排除：`q=tag1+-tag2`

### Tasks
- `POST /api/tasks/` — 创建图片处理任务（Bot 调用）

### Webhook
- `POST /api/rebuild/` — Caddy 缓存 purge

### 图片
- `GET /i/{bucket}/{key}` — S3 直连（Caddy 代理）

---

## 核心流程：甩链即存

```
用户发链接到 Bot
    → Bot 用 aiogram 消息解析提取 URL
    → 识别 source_site + source_id
    → Bot 调用 POST /api/tasks/ 发送任务
    → Bot 回复 "⏳ 正在下载..."

ARQ Worker (process_image):
    → source_resolver 解析 URL → source_site + source_id
    → source_extractor 提取元数据（标题、标签、图片 URL）
    → gallery-dl 下载原图 + infojson 元数据（如支持）
    → 下载前 HEAD 检查 Content-Length，超过 6MB 拒绝
    → 计算感知哈希，检查是否重复
    → Pillow 生成缩略图（thumb / preview）
    → 上传原图 + 缩略图到 S3
    → 写入数据库（Post + Tags）
    → 可选：purge Caddy 缓存

失败路径：
    → 下载失败 → Bot 回复 "❌ 下载失败：{原因}"
    → 图片超 6MB → Bot 回复 "❌ 文件过大（{size}MB），上限 6MB"
    → 重复 → Bot 回复 "⚠️ 已存在：{链接}"
```

---

## 前端设计：SSR + 分页 + Caddy 缓存

### 分页设计
- **页面底部**：传统分页导航 `< 1 2 3 ... 50 >`
- **角落控件**：每页数量切换器，选项：`20 | 40 | 100`（默认 40）
- 切换每页数量时跳转到第 1 页

### 布局
- **首页**：Masonry 瀑布流 + 分页 + 每页数量切换
- **标签页**：标签云（分类着色）+ 热门标签列表 + 分页
- **详情页**：大图 + 侧栏标签列表 + 来源链接 + 相邻导航
- **搜索页**：搜索栏 + 标签自动补全 + 结果分页

### 视觉风格
- **色调**：淡青 (#7DD3C0) → 薄荷绿 (#A7F3D0) → 天蓝 (#BAE6FD) 渐变
- **三态主题**：auto / dark / light 单按钮切换
- **卡片**：圆角 + 柔和阴影 + hover 上浮 + 标签预览浮现
- **图片渐进加载**：blur placeholder → 缩略图 → 预览图 → 点击看原图
- **响应式**：移动端 2 列，平板 3 列，桌面 4-5 列

---

## 开发阶段及当前进度

### ✅ Phase 1：基础设施 + 后端核心（完成）
- [x] Docker Compose（production + dev）+ Caddyfile + .env
- [x] 数据模型 + Alembic 迁移 + 所有索引
- [x] S3 存储抽象层（通用，支持 R2/MinIO/AWS S3）
- [x] 图片处理管线（下载、6MB 校验、缩略图、phash）
- [x] ARQ 任务队列 + gallery-dl Python API 集成
- [x] API routes（posts、tags、search、tasks、webhook）+ Pydantic Settings
- [x] 来源解析器（Pixiv、Twitter、Danbooru、通用）
- [x] by-source 查询端点 + tags autocomplete 端点

### ✅ Phase 2：Telegram Bot（完成）
- [x] Bot 入口 + webhook（aiogram 3 aiohttp server）
- [x] URL 检测 + 来源识别
- [x] ARQ 任务对接
- [x] /save /search /info /start 指令
- [x] Admin 认证中间件
- [x] Inline keyboard 搜索结果分页

### ✅ Phase 3：前端展示（完成）
- [x] Astro SSR 项目搭建 + 主题系统 + 三态切换
- [x] react-photo-album/server 瀑布流（零 JS）
- [x] 分页组件 + 每页数量切换器
- [x] 首页（分页浏览）
- [x] 标签浏览页 + 标签详情页
- [x] 详情页
- [x] 搜索功能 + 标签自动补全
- [x] Caddy 缓存 purge 对接

### 🔲 Phase 4：完善（待做）
- [ ] 更多 extractor（Twitter 完整支持、Danbooru 元数据）
- [ ] 去重机制完善（phash 前缀桶数据库索引优化）
- [ ] 性能优化（Redis 缓存热门查询）
- [ ] `npm install` + 前端构建验证
- [ ] 数据库迁移测试（alembic upgrade head）
- [ ] Caddy 宿主机部署 + TLS 证书
- [ ] Pixiv 认证填入 .env
- [ ] 端到端测试
- [ ] 部署文档

---

## 验证方式

1. **Bot 流程**：发 Pixiv 链接 → 收到"正在下载" → 收到"已收藏" → 前端立即可见
2. **前端性能**：Caddy 缓存命中时 TTFB < 10ms，列表页零 JS 首屏
3. **分页**：切换页码和每页数量正常，URL 可分享
4. **S3 直连**：`/i/{bucket}/{key}` 不经后端，Caddy 直接代理 S3
5. **6MB 限制**：超大图被拒绝，Bot 回复具体原因
6. **去重**：相同图片重复发送时 Bot 提示已存在
7. **明暗主题**：三态切换正常，系统偏好自动匹配