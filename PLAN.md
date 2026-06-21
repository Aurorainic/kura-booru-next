# Kura Booru Next — 项目计划

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
| **前端** | Astro | 5.x | **SSR 模式**（非 SSG） |
| | React | 19.x | 交互组件 Islands |
| | Tailwind CSS | v4 | 样式 |
| **存储** | S3 兼容协议 | — | 对象存储（R2/MinIO/AWS S3 通用） |
| **数据库** | PostgreSQL | 16+ | 主数据存储 |
| **缓存/队列** | Redis | 7.x | ARQ 队列 + Caddy 缓存后端 |
| **反代** | Caddy | 2.x | 宿主机运行，HTTPS + 缓存 + 反代 |
| **部署** | Docker Compose | v2 | 编排后端/Bot/前端/数据库/Redis |

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

---

## 数据模型

### Post
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| s3_key | String | S3 原图路径 |
| thumb_key | String | S3 缩略图路径 |
| preview_key | String | S3 预览图路径 |
| source_url | String | 原始链接 |
| source_site | Enum | pixiv / twitter / danbooru / other |
| source_id | String | 来源站点的作品 ID |
| width / height | Integer | 原图尺寸 |
| file_size | Integer | 文件大小 bytes |
| mime_type | String | image/png 等 |
| title | String? | 作品标题 |
| description | Text? | 作品描述 |
| rating | Enum | safe / questionable / explicit |
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
| post_id | UUID (FK, ON DELETE CASCADE) |
| tag_id | UUID (FK, ON DELETE CASCADE) |

### TagAlias (标签别名)
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| alias_name | String | 别名（唯一） |
| tag_id | UUID (FK) | 指向正式标签 |

### AutoRatingRule
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| tag_name | String | 触发标签名（唯一） |
| target_rating | Enum | 目标评级（questionable/explicit） |
| created_at | DateTime | 创建时间 |

### Admin
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| username | String | 用户名（唯一） |
| password_hash | String | bcrypt 哈希 |
| created_at | DateTime | 创建时间 |

---

## API 设计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/posts?page=1&per_page=40&rating=safe` | 分页帖子列表（admin 可按评级筛选） |
| GET | `/api/posts/{id}` | 帖子详情（非 safe 对访客返回 404） |
| GET | `/api/posts/random` | 随机帖子（访客仅 safe） |
| GET | `/api/posts/by-source?source_site=pixiv&source_id=123` | 按来源查找 |
| PATCH | `/api/posts/{id}` | 修改帖子评级（admin only） |
| DELETE | `/api/posts/{id}` | 删除帖子（admin only，同步删 S3 + 减 tag count） |
| GET | `/api/tags?category=artist&sort=count` | 标签列表（访客仅见 safe 关联标签） |
| GET | `/api/tags/{name}` | 标签详情（访客: 无 safe 关联则 404） |
| GET | `/api/tags/autocomplete?q=prefix` | 标签自动补全（访客仅见 safe 关联标签） |
| GET | `/api/search?q=tag1+tag2+rating:safe` | 标签搜索（支持 `-` 排除，`rating:` 筛选） |
| POST | `/api/tasks/` | 创建图片处理任务（需 X-Api-Key） |
| POST | `/api/tasks/web-import` | 批量导入图片（需 admin session） |
| GET | `/api/auto-rating-rules` | 列出自动评级规则（admin only） |
| POST | `/api/auto-rating-rules` | 创建自动评级规则（admin only） |
| DELETE | `/api/auto-rating-rules/{id}` | 删除自动评级规则（admin only） |
| POST | `/api/rebuild/` | 清除 Caddy 缓存（需 X-Api-Key） |
| POST | `/api/auth/login` | 管理员登录 |
| POST | `/api/auth/logout` | 管理员登出 |
| POST | `/api/auth/change-password` | 修改密码 |
| GET | `/api/auth/status` | 登录状态检查 |
| GET | `/health` | 后端健康检查 |

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
    → 检查自动评级规则，如有匹配则升级评级（仅升级不降级）
    → 写入数据库（Post + Tags + AutoRatingRule check）
    → 可选：purge Caddy 缓存

失败路径：
    → 下载失败 → Bot 回复 "❌ 下载失败：{原因}"
    → 图片超 6MB → Bot 回复 "❌ 文件过大（{size}MB），上限 6MB"
    → 重复 → Bot 回复 "⚠️ 已存在：{链接}"
```

---

## 管理后台

| 页面 | 路径 | 功能 |
|---|---|---|
| 图片管理 | `/admin/posts` | 全图列表（含 q/e），评级筛选，内联改评级，删除按钮 |
| 自动评级规则 | `/admin/auto-rating` | 规则列表，添加规则（带标签自动补全），删除规则 |
| 导入图片 | `/admin/import` | 文本框批量输入 URL（每行一个），一键导入，状态反馈 |
| 修改密码 | `/admin/password` | 当前密码 + 新密码 + 确认 |

---

## 前端设计：SSR + 分页 + Caddy 缓存

### 分页设计
- **页面底部**：传统分页导航 `< 1 2 3 ... 50 >`
- **角落控件**：每页数量切换器，选项：`20 | 40 | 100`（默认 40）
- 切换每页数量时跳转到第 1 页

### 布局
- **首页**：Masonry 瀑布流 + 分页 + 每页数量切换 + 评级筛选（admin）
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
- [x] 数据模型 + Alembic 迁移（001~004）+ 所有索引
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
- [x] 标签分类系统 — Pixiv/Danbooru 来源标签自动分类
- [x] Bot 转发消息支持
- [x] HTML 描述渲染

### ✅ Phase 5：Danbooru 化 + 管理后台 & NSFW 可见性（完成）
- [x] 评级系统 — Post 新增 `rating` 字段（safe/questionable/explicit）
- [x] 可见性规则 — 访客只看 safe，非 safe 图 404（隐藏存在性）
- [x] Admin 认证 — DB 存储管理员凭证，首次启动自动创建
- [x] Auth API — login / logout / change-password / status
- [x] API 密钥 — POST /api/tasks/ 和 /api/rebuild/ 需要 X-Api-Key
- [x] 评级编辑 — PATCH /api/posts/{id} + 前端内联下拉
- [x] 源数据自动赋值 — Pixiv x_restrict + Danbooru rating
- [x] Danbooru 标签侧栏 — 详情页按分类+计数分组
- [x] 评级徽章 + 评级筛选 + `rating:` 搜索语法
- [x] 管理页 + 登录页 + 改密码页 + 404 页
- [x] SSR cookie 转发 + 中间件
- [x] Alembic 迁移 002~003

### ✅ Phase 6：v0.2.0 管理增强（完成）
- [x] 退出登录重定向到首页
- [x] 修复密码修改图标（lock-closed）
- [x] 标签可见性修复（非 admin 不见非 safe 关联标签）
- [x] 管理面板删除功能（S3 + DB + tag count）
- [x] 标签自动评级规则（模型 + 迁移 + API + 前端 + process_image 集成）
- [x] 网页端批量导入（web-import 端点 + 管理页面）

### ✅ Phase 6.5：v0.2.1~v0.2.2 Bot 评级交互优化（完成）
- [x] Bot 评级选择菜单（🟢/🟡/🔴 内联按钮替代自动链接）
- [x] 评级选择阶段显示「等待评级」而非「处理完成」
- [x] 10 秒倒计时自动确认（有规则按规则，无规则默认公开）
- [x] 自动规则建议提示（`建议评级: 🟡 敏感（自动规则）`）
- [x] 用户手动选择始终优先（可降级覆盖自动规则）
- [x] 退出登录 Cookie 删除修复（`secure`/`httponly`/`samesite` 属性匹配）

### 🔲 Phase 7：完善（待做）
- [ ] 更多 extractor（Twitter 完整支持、Danbooru 元数据）
- [ ] 去重机制完善（phash 前缀桶数据库索引优化）
- [ ] 性能优化（Redis 缓存热门查询）
- [ ] 端到端测试
- [ ] SSR 缓存启用（需先解决 Vary: Cookie + 缓存 key 问题）
- [ ] 监控与告警（Prometheus + Grafana）
- [ ] 自动化 CI/CD（Gitea Actions）
- [ ] 数据库定期备份 cron
- [ ] Admin 密码修改后旧 session 失效机制
- [ ] SSE/WebSocket 任务状态推送

---

## 验证方式

1. **Bot 流程**：发 Pixiv 链接 → 收到"正在下载" → 收到"已收藏" → 前端立即可见
2. **Web 导入**：贴入多个 URL → 点击导入 → 各 URL 显示"已入队" → ARQ 处理后前端可见
3. **删除流程**：管理面板点删除 → 确认 → 数据库记录消失 + S3 文件删除 + tag 计数减少
4. **自动评级**：添加规则"nsfw → explicit" → 导入含该标签图片 → 自动标记为 explicit
5. **标签可见性**：匿名访客看不到仅关联非 safe 帖子的标签；admin 可见全部
6. **前端性能**：Caddy 缓存命中时 TTFB < 10ms，列表页零 JS 首屏
7. **分页**：切换页码和每页数量正常，URL 可分享
8. **S3 直连**：图片不经后端，Caddy 直接代理 S3
9. **6MB 限制**：超大图被拒绝，Bot 回复具体原因
10. **去重**：相同图片重复发送时 Bot 提示已存在
11. **明暗主题**：三态切换正常，系统偏好自动匹配
12. **评级可见性**：匿名访客只能看到 safe 图；非 safe 图返回 404；admin 登录后可见全部
13. **管理员登录/退出**：`/login` → 首页显示"管理模式" → 点退出 → 回到首页

---

## v0.1.0 代码审计与清理（已完成）

**审计日期**：2026-06-19  
**状态**：✅ 所有 P0/P1/P2/P3 项已完成

### P0 — 必须修复 ✅

| # | 问题 | 修复 | 状态 |
|---|---|---|---|
| 1 | `PhotoAlbum.tsx` 死代码 | 已删除（被 `PhotoAlbum.astro` 替代） | ✅ |
| 2 | `tailwind.config.mjs/` 空目录 | 已删除 | ✅ |
| 3 | `save.py` ≈ `url_handler.py` 逻辑重复 | 提取 `process_url()` 共享函数 | ✅ |
| 4 | `source_resolver.py` 死代码 | 已删除（各 extractor 自行解析 URL） | ✅ |

### P1 — 强烈建议 ✅

| # | 问题 | 修复 | 状态 |
|---|---|---|---|
| 5 | 未使用 npm 依赖 | 移除 3 个包 | ✅ |
| 6 | `ALLOWED_PER_PAGE` 三处重复 | 新建 `constants.py`，统一导出 | ✅ |
| 7 | `PostCreate`/`TagCreate` 未使用 schemas | 已删除 | ✅ |
| 8 | `enqueue_process_image()` 死代码 | 从 `arq_client.py` 删除 | ✅ |
| 9 | `api.ts` 死导出 | 删除 2 项 | ✅ |

### P2 — 推荐 ✅

| # | 问题 | 修复 | 状态 |
|---|---|---|---|
| 10 | `main.py` config 导入不一致 | 保持现状 | ✅ |
| 11 | `pipeline.py` 重复导入 | 删除内部导入 | ✅ |
| 12 | `info.py` 未使用导入 | 删除 | ✅ |
| 13 | 分页默认值重复 | 添加工具函数到 `api.ts` | ✅ |
| 14 | `tags/index.astro` 重复颜色映射 | 改用共享函数 | ✅ |

### P3 — 优化 ✅

| # | 问题 | 修复 | 状态 |
|---|---|---|---|
| 15 | Bot 硬编码 URL | 新增 `FRONTEND_URL` env var | ✅ |
| 16 | `BaseLayout.astro` 硬编码 gitTag | 改用 `import.meta.env` | ✅ |
| 17 | `BaseLayout.astro` 硬编码 Gitea 链接 | 改用 `import.meta.env` | ✅ |
