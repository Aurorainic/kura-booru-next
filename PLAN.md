# Kura Booru Next — 项目计划（修订版）

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
- [x] HTML 描述渲染（bleach 清洗 + set:html 渲染）

### ✅ Phase 3.5：v0.1.2 功能增强（完成）
- [x] 标签分类系统 — Pixiv/Danbooru 来源标签自动分类（画师/角色/版权/通用/元信息）
- [x] Bot 转发消息支持 — 正确处理 TG 频道转发的包含图片链接的消息
- [x] HTML 描述渲染 — Pixiv 插画简介中的超链接正确显示

### 🔲 Phase 4：完善（待做）
- [ ] 更多 extractor（Twitter 完整支持、Danbooru 元数据）
- [ ] 去重机制完善（phash 前缀桶数据库索引优化）
- [ ] 性能优化（Redis 缓存热门查询）
- [ ] 端到端测试
- [ ] 部署文档

### 🔲 Phase 6：待做（v0.1.3+ 后续）

#### 后端
- [ ] Twitter extractor 完善（完整元数据提取）
- [ ] Danbooru extractor 完善（rating 字段已对接，元数据还需细化）
- [ ] Tag `post_count` 自动同步（目前需手动 SQL）
- [ ] phash 去重性能优化（前缀桶索引）
- [ ] Admin 密码修改后旧 session 失效机制（当前 session cookie 仍用旧密码验证直到过期）
- [ ] SSE/WebSocket 任务状态推送（Bot 端实时查看 /save 进度）
- [ ] 网页 URL 录入工作流（管理员在后台贴 URL → 调 POST /api/tasks/ → 显示处理状态）
- [ ] 批量录入支持（Bot 转发多条链接时按顺序处理并显示进度）

#### 前端
- [ ] 搜索栏 `rating:` 语法高亮提示（admin 模式下显示可用语法提示）
- [ ] 管理页批量评级修改（多选 + 批量设为 safe/q/e）
- [ ] 详情页来源链接改为 Danbooru 风格站点标识（Pixiv → 小图标 + 链接）
- [ ] 图片渐进加载优化（blur placeholder → thumb → preview → original 四级加载）
- [ ] 标签页 `post_count` 实时准确性（目前 tag.post_count 需手动 SQL 同步）
- [ ] 404/错误页面美化（当前 404 页面功能但视觉简单）

#### 基础设施
- [ ] SSR 缓存启用（需先解决 `Vary: Cookie` + 缓存 key 问题，否则 admin 页面会泄漏给匿名访客）
- [ ] 监控与告警（Prometheus + Grafana）
- [ ] 自动化 CI/CD（GitHub Actions / Gitea Actions）
- [ ] HTTPS 证书自动续期（Caddy 已内置）
- [ ] 数据库定期备份 cron
- [ ] 生产环境 Caddy Souin 缓存配置（需 Vary: Cookie）

### ✅ Phase 5：Danbooru 化 + 管理后台 & NSFW 可见性（完成）
- [x] 评级系统 — Post 新增 `rating` 字段（safe/questionable/explicit，对齐 Danbooru）
- [x] 可见性规则 — 访客只看 safe，非 safe 图 404（隐藏存在性）；admin 登录解锁全部
- [x] Admin 认证 — 管理员凭证存 DB（`admins` 表），首次启动自动创建+随机密码输出到日志
- [x] Auth API — POST /api/auth/login|logout|change-password, GET /api/auth/status
- [x] API 密钥 — POST /api/tasks/ 和 /api/rebuild/ 需要 X-Api-Key（Bot 共享密钥）
- [x] 评级编辑 — PATCH /api/posts/{id}（admin-only）+ 前端内联下拉
- [x] 源数据自动赋值 — Pixiv x_restrict + Danbooru rating 自动映射
- [x] Danbooru 标签侧栏 — 详情页按 分类+计数 分组，移动端扁平展示
- [x] 评级徽章 — 卡片角标（Q/E），详情页评级标签（S/Q/E 三色）
- [x] 评级筛选 — 首页 S/Q/E chip（admin），搜索 `rating:` 语法（admin）
- [x] 管理页 — /admin/posts 全图列表 + 评级筛选 + 内联改评级
- [x] 登录页 — /login 用户名+密码
- [x] 导航 — 登录/退出/管理链接 + 管理模式横幅
- [x] 404 页 — 修复详情页重定向到不存在的 /404
- [x] SSR cookie 转发 — Astro middleware + api.ts ssrCookie 参数
- [x] Alembic 迁移 002 — rating_enum + posts.rating 列
- [x] Alembic 迁移 003 — admins 表（username + password_hash）
- [x] 改密码页面 — /admin/password 当前密码+新密码表单
- [x] 删除 ADMIN_PASSWORD_HASH env var — 改为 DB 存储方式

---

## 验证方式

1. **Bot 流程**：发 Pixiv 链接 → 收到"正在下载" → 收到"已收藏" → 前端立即可见
2. **前端性能**：Caddy 缓存命中时 TTFB < 10ms，列表页零 JS 首屏
3. **分页**：切换页码和每页数量正常，URL 可分享
4. **S3 直连**：`/i/{bucket}/{key}` 不经后端，Caddy 直接代理 S3
5. **6MB 限制**：超大图被拒绝，Bot 回复具体原因
6. **去重**：相同图片重复发送时 Bot 提示已存在
7. **明暗主题**：三态切换正常，系统偏好自动匹配
8. **标签分类**：Pixiv 插画的 artist/character/copyright 标签正确分类
9. **HTML 描述**：Pixiv 插画简介中的超链接可点击，新窗口打开
10. **转发消息**：从 TG 频道转发包含链接的消息，Bot 正确解析并处理
11. **评级可见性**：匿名访客只能看到 safe 图；非 safe 图返回 404；admin 登录后可见全部
12. **管理员登录**：`/login` 页面登录 → 首页显示"管理模式"横幅 → 导航栏显示管理/退出
13. **评级编辑**：详情页 admin 可切换公开/私用 → PATCH 请求成功 → 刷新后评级更新
14. **评级筛选**：首页 S/Q/E chip 仅 admin 可见，点击后过滤对应评级；搜索支持 `rating:safe`
15. **API 密钥**：不带 `X-Api-Key` 的 POST /api/tasks/ 返回 401；Bot 发送密钥后正常调用
16. **Danbooru 标签侧栏**：详情页桌面端左侧标签按分类分组+计数；移动端标签在图下方
17. **管理页**：`/admin/posts` 列出所有图（含 q/e），评级筛选正常，内联改评级即时生效
18. **SSR 缓存约束**：确认 Caddyfile 无 SSR HTML 缓存块（或已加 Vary: Cookie）

---

## v0.1.0 代码审计与清理（已完成）

**审计日期**：2026-06-19  
**状态**：✅ 所有 P0/P1/P2/P3 项已完成

### P0 — 必须修复（影响功能或架构）✅

| # | 问题 | 修复 | 状态 |
|---|---|---|---|
| 1 | `PhotoAlbum.tsx` 死代码 | 已删除（被 `PhotoAlbum.astro` 替代） | ✅ |
| 2 | `tailwind.config.mjs/` 空目录 | 已删除 | ✅ |
| 3 | `save.py` ≈ `url_handler.py` 逻辑重复 | 提取 `process_url()` 共享函数，`save.py` 简化为命令解析 | ✅ |
| 4 | `source_resolver.py` 死代码 | 已删除（各 extractor 自行解析 URL） | ✅ |

### P1 — 强烈建议（提高可维护性）✅

| # | 问题 | 修复 | 状态 |
|---|---|---|---|
| 5 | 未使用 npm 依赖 | 移除 `react-photo-album`, `@tanstack/react-query`, `class-variance-authority` | ✅ |
| 6 | `ALLOWED_PER_PAGE` 三处重复 | 新建 `backend/app/api/constants.py`，统一导出 | ✅ |
| 7 | `PostCreate`/`TagCreate` 未使用 schemas | 已删除 | ✅ |
| 8 | `enqueue_process_image()` 死代码 | 从 `arq_client.py` 删除（Bot 通过 HTTP API 调用） | ✅ |
| 9 | `api.ts` 死导出 | 删除 `fetchRandomPost`, `TagsResponse` | ✅ |

### P2 — 推荐（代码整洁）✅

| # | 问题 | 修复 | 状态 |
|---|---|---|---|
| 10 | `main.py` config 导入不一致 | 保持现状（`settings` 单例足够） | ✅ |
| 11 | `pipeline.py` 重复导入 | 删除内部 `from PIL import ImageOps`，保留顶部 | ✅ |
| 12 | `info.py` 未使用导入 | 删除 `get_post` import | ✅ |
| 13 | 分页默认值重复 | 添加 `clampPerPage()`, `emptyPostsResponse()` 到 `api.ts` | ✅ |
| 14 | `tags/index.astro` 重复颜色映射 | 改用 `getTagCategoryColor()` 替代 inline `categoryColorMap` | ✅ |

### P3 — 优化（提升体验）✅

| # | 问题 | 修复 | 状态 |
|---|---|---|---|
| 15 | Bot 硬编码 URL | 新增 `FRONTEND_URL` env var 到 `bot/app/config.py` | ✅ |
| 16 | `BaseLayout.astro` 硬编码 gitTag | 改用 `import.meta.env.PUBLIC_GIT_TAG` | ✅ |
| 17 | `BaseLayout.astro` 硬编码 Gitea 链接 | 改用 `import.meta.env.PUBLIC_REPO_URL` | ✅ |

### 文档更新 ✅

| # | 更新内容 | 状态 |
|---|---|---|
| 18 | `CLAUDE.md` — 更新项目结构、状态、技术栈 | ✅ |
| 19 | `PLAN.md` — 标记 Phase 1-3 完成、添加审计章节 | ✅ |

---

## 下次 Session 待办（v0.1.0 发布后）

### 短期改进
- [ ] Twitter extractor 完善（完整元数据提取）
- [ ] Danbooru extractor 完善
- [ ] Tag `post_count` 自动同步（触发器或定时任务）
- [ ] phash dedup 性能优化

### 长期 Roadmap
- [ ] Admin UI（管理后台）
- [ ] 批量导入工具
- [ ] 更多 S3 存储提供商测试
- [ ] 监控与告警（Prometheus + Grafana）
- [ ] 自动化部署（CI/CD）
