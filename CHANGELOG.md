# 变更日志

本文件记录项目的所有重要变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.6.0] - 2026-06-26

### 新增
- **站点设置系统** — DB 驱动的 key-value 配置，替代部分 `.env` 硬编码。管理后台 UI 直接修改，无需编辑文件重启容器。
  - `Setting` 模型 — `settings` 表（key PK + value + updated_at），Alembic 迁移 007
  - `GET /api/settings/` — 管理员读取全部设置（含基础设施 URL）
  - `PUT /api/settings/` — 管理员批量更新设置
  - `GET /api/settings/public` — 公开端点，仅返回非敏感设置（site_title / site_description / announcement / head_inject / maintenance_mode）
  - `POST /api/settings/test-pg` — 临时引擎测试 PG 连通性（管理员）
  - `POST /api/settings/test-redis` — 临时客户端测试 Redis 连通性（管理员）
  - Redis 缓存 — 单 hash key `kura:settings`，300s TTL，更新时刷新
  - 启动时从环境变量 seed — `INSERT ... ON CONFLICT DO NOTHING`，不覆盖已有值
- **站点标题 / 描述可配置** — 从 `siteSettings` 读取，替代硬编码 `"Kura Booru"` / `"个人动漫插画收藏与展示平台"`。导航栏标题自动拆分（首词 gradient + 其余 muted）。
- **公告横幅** — 顶部细横幅（32px），紧贴导航栏下方。每行一条公告，多行时每 5s 上下滑动切换；单行超宽时以 28px/s 缓慢横向滚动。支持内联 Markdown（加粗/斜体/代码/链接）。可手动关闭，sessionStorage 记忆已关闭状态（导航不重复弹出）。替代原右上角 Toast。
- **维护模式** — 管理后台设置页新增「调试 / 维护」开关。开启后非管理员访问任何页面被 302 重定向到 `/maintenance` 维护提示页；管理员凭 session cookie 绕过，可正常访问全站关闭维护。中间件手动构造重定向响应并附 `Cache-Control: private, no-store`，防止 CDN 缓存导致用户卡死。设置缓存失败时 back off 整个 TTL 并保留 stale 数据，避免 hammer 死掉的后端。
- **Head 注入** — 管理后台可注入分析脚本等 HTML 到 `<head>`，用于接入 Umami 等访问追踪。
- **管理后台标签页整合** — 原 `/admin/posts`、`/admin/tags`、`/admin/auto-rating`、`/admin/settings`、`/admin/password`、`/admin/import` 六个独立页面整合为单页 `/admin` + 子标签页（URL `?tab=` 驱动，支持浏览器前进/后退）。旧路径 301 重定向到对应标签。
- **主题色选择器** (`AccentPicker.tsx`) — 导航栏新增调色板按钮，拖动色相滑块实时改变全站 accent 色。Cookie + localStorage 双写持久化，SSR 读 Cookie 在首帧即设置 CSS 变量，消除 anti-flash。
- **每页数量 Cookie 持久化** — `per_page` 偏好从 localStorage 迁移到 Cookie，SSR 可读，首次加载即应用偏好，消除原客户端 `window.location.replace` 重定向闪烁。
- **前端中间件设置缓存** — 30s 进程内缓存 `GET /api/settings/public`，避免每请求打后端。

### 变更
- **Docker 镜像标签** — 升级为 `v0.6.0`。
- **BaseLayout** — 标题/描述/footer 从 `siteSettings` 动态读取；公告改为顶部横幅；管理员菜单新增"站点设置"链接（桌面 + 移动端）；accent hue 从 Cookie 读取并在 `<html>` 上设置 CSS 变量。
- **前端中间件** — 新增 `context.locals.siteSettings`，30s 进程内缓存；新增维护模式重定向逻辑（非管理员拦截，带 `Cache-Control`）。
- **`env.d.ts`** — `Astro.locals` 新增 `siteSettings` 类型声明（含 `maintenance_mode`）。
- **通用标签颜色** — `.tag-general` / 标签分类背景色不再跟随全站 accent hue，改回固定青绿色 `oklch(72% 0.12 175)`，与 `--color-tag-general` 定义一致。
- **`docs/operations.md`** — 移除 Huawei SWR 专用推送说明（`--provenance=false --sbom=false`），构建示例版本号更新。

## [0.5.0] - 2026-06-24 — 已发布

### 新增
- **密码修改后 Session 失效** — `password_changed_at` 列记录最后改密时间，`get_is_admin` / `get_current_admin` 比较 cookie `iat` 与 epoch（Redis 60s 缓存），旧 session 自动拒绝。Redis 故障时 fail-open。改密后清 cookie + 跳转登录页。
- **Chromium 浏览器扩展** — Manifest V3，Pixiv 作品页浮动"Import to Kura"按钮，API key 认证，`POST /api/tasks/` 入队 + `GET /api/tasks/{task_id}` 轮询结果。Popup 设置服务器 URL + API key。
- **`GET /api/tasks/{task_id}` 端点** — 任务状态轮询（X-Api-Key 鉴权），供扩展和外部集成使用。
- **项目 Logo** — `logo.svg` 三卡扇形图标，首页 header 改为 logo + "Kura Booru" 文字，favicon 同步更新。
- **扩展打包 workflow** — `.github/workflows/build-extension.yml`，推送 `extension/` 时自动 rasterize SVG → PNG + 打包 zip artifact。

### 变更
- **Docker 镜像标签** — 升级为 `v0.5.0`。
- **`get_is_admin` 不再纯 cookie 验证** — 现在额外检查 Redis 缓存的 `password_changed_at` epoch，cookie `iat` 早于 epoch 则拒绝。
- **改密端点返回 cookie-clearing 响应** — `POST /api/auth/change-password` 现在清 session cookie，前端改密成功后跳转 `/login`。
- **README** — 顶部 emoji 标题改为居中 logo.svg + 文字。

### 修复
- **`_ensure_tags` 并发 UniqueViolation** — 多 worker 同时插入同名 tag 时 `IntegrityError`，改为 catch + rollback + 重新查询已存在行。

### 安全
- 密码修改后所有旧 session 立即失效（Redis epoch 比较），不再依赖 7 天自然过期。

## [0.4.2] - 2026-06-23 — 已发布

### 变更
- **`_ensure_tags` 批量查询** — N+1 循环（每 tag 2-3 次 SELECT）改为 3 次批量查询（alias + tag + canonical）。30 个标签：60→3 次查询。
- **S3 客户端复用** — 懒缓存 S3 客户端替代每次操作新建。单一客户端跨上传/验证复用，lifespan 中注册关闭清理。
- **`random_post` 计数缓存** — 进程内 5 分钟 TTL 缓存，跳过重复随机请求的 COUNT(*)。

### 新增
- **Tag `post_count` 自动同步** — ARQ 定时任务（每小时 + 启动时）从 `post_tags` 重算 `post_count`，修复 +=1/-=1 累积漂移。
- **Cache-Control 响应头** — API 中间件：匿名响应 `public, s-maxage=60`，管理员响应 `private, no-store`。SSE 端点保留自有 `no-cache`。SSR HTML 始终 `private, no-store`。

## [0.4.1] - 2026-06-23 — 已发布

### 新增
- **Pixiv 多图帖子只抓第一张** — gallery-dl `image-range` 配置 `"1-1"`，仅下载 Pixiv 多图帖的第一张图。防御性加固：`_download_sync` 文件读取改为排序取首，双重保险。
- **详情页管理员删除按钮** — 右侧 info sidebar 添加红色「删除作品」按钮（仅管理员可见），删除后跳转画廊首页 `/`。
- **网页端批量导入队列实时更新（SSE）** — `GET /api/tasks/web-import/stream` 端点，复用 ARQ 轮询模型，实时推送每个 job 的完成状态（success / duplicate / too_large / failed）+ 最终汇总。前端 `import.astro` 使用 `EventSource` 实时更新每行状态。
- **Caddy `flush_interval -1`** — `/api/*` reverse_proxy 块新增 `flush_interval -1`，确保 SSE 流不被 Caddy 缓冲。

### 变更
- **import.astro 实时视图** — 从「已入队 ✓ / 失败 ✗」静态显示改为 SSE 实时进度：⏳ 处理中 → ✅/⚠️/❌ 完成状态，done 事件显示汇总。
- **roadmap.md** — 合并重复的 SSE/WebSocket 条目，标记已完成功能。

## [0.4.0] - 2026-06-22 — 已发布

### 新增
- **AI Retag** — 新图入库时自动调用 OpenAI 兼容 API（DeepSeek 等）对标签进行 5 类分类（artist / character / copyright / general / meta）+ 中文翻译 + Danbooru 标准命名。结果缓存到 `tag_knowledge` 表，避免重复调用。由 `ENABLE_AI_TAG_PROCESSING` + `AI_PROVIDER_*` 环境变量控制。
- **`tag_knowledge` 知识库表** — 作为 AI 结果的 truth source，`Tag` 表的分类/翻译字段成为冗余副本。支持 `ai` / `manual` / `danbooru_import` / `danbooru_api` 四种 source。
- **管理后台标签管理页** (`/admin/tags`) — 列表/筛选/搜索、行内编辑分类与翻译、标签合并、触发 AI 重处理（仅未处理 / 全部强制重处理）。
- **详情页管理员标签编辑** — 左侧标签栏每行 hover 显示红色 ✕ 移除按钮，底部输入框可添加新标签。
- **Footer AI 胶囊** — 当 `ENABLE_AI_TAG_PROCESSING=true` 时，左下角版本号胶囊旁额外显示紫色白字"AI ✦"胶囊。Footer 改为 `flex-wrap`，移动端拥挤时右下角"个人动漫插画收藏"自动换行。
- **横幅"安全"二字高亮** — 非管理员横幅中"安全"使用站点主题色（`var(--accent-color)`，绿色）显示。

### 修复
- **标签管理页空白** — `admin/tags.astro` frontmatter 中 `fetchAdminTags` 调用误用 `per_page`（下划线变量名不存在），实际变量是 `perPage`（驼峰）。`ReferenceError` 被静默 `try/catch` 吞掉，页面渲染"共 0 个标签"。改为 `per_page: perPage`。
- **详情页标签移除按钮定位错误** — `<li>` 缺少 `relative`，导致 `absolute` 按钮相对外层 `.card` 定位，所有 ✕ 叠在同一位置。给 `<li>` 加 `relative`，按钮改为垂直居中。
- **`admin/tags.astro` 误导入不存在的 `getTagCategoryColorClass`** — `api.ts` 只导出 `getTagCategoryColor`。删除未使用的导入。

### 变更
- **数据库迁移 005** — `tags` 表新增 `danbooru_name` / `translation` / `ai_processed_at`；`posts` 表新增 `ai_tag_processed_at` / `ai_tag_status`；新建 `tag_knowledge` 表。
- **Docker 镜像标签** — 从 `v0.4.0-dev` 升级为 `v0.4.0`。
- **Footer 布局** — `flex` 改为 `flex-wrap` + `gap-y-2`，左侧胶囊组改为 `inline-flex items-center gap-2`。

## [0.3.0] - 2026-06-16 — 已发布

### 新增
- **PG18 + Redis8 迁移** — 生产环境从 PG16 + Redis7 升级到 PG18 + Redis8，启用新版本性能特性。
- **Bot `_confirmed_posts` Redis SETEX 机制** — Bot 重启后已确认帖子不重复推送，24h TTL 自动过期。
- **phash 去重基础实现** — 感知哈希（perceptual hash）去重，前缀桶索引加速查找，新图入库时自动检测重复。

### 变更
- **单用户场景优化** — PG18 `io_method` + Redis8 `activedefrag` / `HSETEX`，针对单管理员使用模式调优。

## [0.2.3] - 2026-06-21 — 已发布

### 修复
- **Logout 未真正清除 session** — 用服务端 Astro 端点（`POST /logout`）替代客户端 `fetch()` 登出。之前存在竞态条件：浏览器在 `Set-Cookie` 生效前就跳转到 `/`，旧 session cookie 仍然存活。新 SSR 端点转发 cookie 到后端，在 302 重向中注入 `Set-Cookie` 删除指令，确保 cookie 在下次请求前被清除。
- **管理后台缩略图在使用直连 S3/CDN 时 404** — `admin/posts.astro` 使用硬编码 `/i/{thumb_key}` 路径而非 `getThumbUrl()` 辅助函数。当 `PUBLIC_S3_EXTERNAL_URL` 直指 R2/CDN 时（不经 Caddy `/i/*` 代理），所有缩略图返回 404。
- **自动评级页重复 `<script define:vars>` 块** — 删除复制的第二个相同 `TAG_NAMES` 注入块。
- **详情页死代码 `meta[name="api-base"]` 查询** — 评级编辑脚本查询了模板中不存在的 `<meta>` 标签。改为直接使用 `'/api'` 常量。
- **`image_urls` 未去重** — gallery-dl 的 infojson 分支可能追加重复 URL，导致不必要的下载重试。添加 `list(dict.fromkeys(...))` 去重。

### 变更
- **登出按钮改为表单 POST** — "退出登录"按钮从 JS `fetch()` + `window.location.href` 改为原生 `<form action="/logout" method="post">`，彻底消除 cookie/导航竞态条件。
- **前端版本号** — 升级到 `0.2.3`。

## [0.2.2] - 2026-06-21 — 已发布

### 新增
- **Bot 评级选择倒计时** — 评级提示消息显示 10 秒倒计时（`⏳ 等待评级 (Ns)`）。用户未在 10 秒内选择时自动确认：有自动评级规则则使用规则建议的评级（标注`（自动规则）`），无规则则默认 safe（标注`（默认）`）。
- **Bot 自动评级提示** — 自动评级规则匹配帖子标签时，Bot 在评级按钮旁显示 `建议评级: 🟡 敏感（自动规则）`。
- **任务结果 `auto_rating` 字段** — ARQ `process_image` 任务返回 `auto_rating`（规则建议评级或 `null`），供 Bot 显示提示和倒计时自动确认使用。

### 变更
- **评级提示文本** — 从 `✅ 处理完成` 改为 `⏳ 等待评级`。`✅ 处理完成` 仅在用户确认评级后显示。
- **自动确认超时** — 从 5 分钟缩短为 10 秒。
- **手动评级优先于自动评级** — 用户手动选择始终优先，即使比规则建议更宽松。
- **自动确认消息格式** — 显示 `评级: 🟢 公开（默认）` 或 `评级: 🟡 敏感（自动规则）`。

### 修复
- **HTTPS 下登出失败** — `clear_session_cookie` 缺少 `secure` 和 `httponly` 参数，浏览器在 HTTPS 下静默忽略删除指令。删除 cookie 必须匹配设置时的所有属性。

## [0.2.1] - 2026-06-21 — 已发布

### 新增
- **Bot 评级选择菜单** — 图片处理完成后，Bot 显示内联键盘按钮（🟢 公开 / 🟡 敏感 / 🔴 限制）供管理员选择帖子评级，不再自动使用源站评级。

### 变更
- **评级标签重命名** — 评级显示标签统一。
- **Pixiv 评级映射移除** — Pixiv `x_restrict` 不再自动映射为评级（不可靠指标），所有 Pixiv 图片默认 `safe`，需手动升级。
- **瀑布流布局** — 改进前端瀑布流网格渲染。
- **WebP 缩略图** — 缩略图改为 WebP 格式，减小文件体积。
- **管理员下拉菜单** — 管理员导航合并到顶部栏下拉菜单。
- **文件大小限制移除** — `MAX_IMAGE_SIZE` 默认改为 0（无限制）。
- **SSR cookie 修复** — 前端中间件正确转发管理员 session cookie。

## [0.2.0] - 2026-06-20 — 已发布

### 新增
- **帖子删除** — 管理员可从管理页删除帖子。删除数据库记录（级联到 post_tags）、移除所有 S3 对象（原图/缩略图/预览）、递减 tag post_count。
  - `DELETE /api/posts/{id}` 端点（管理员，需完整 session）
  - `/admin/posts` 表格中垃圾桶图标按钮 + 确认对话框
  - Tag `post_count` 原子递减，使用 `GREATEST(post_count - 1, 0)` 防止负数
- **基于标签的自动评级规则** — 特定标签存在时自动升级帖子评级。
  - `AutoRatingRule` 模型 — 标签名 → 目标评级（questionable/explicit）
  - `GET / POST / DELETE /api/auto-rating-rules` — CRUD 端点（管理员）
  - `process_image` 任务在标签解析后检查规则，只升级不降级
  - `/admin/auto-rating` — 管理页，标签自动补全 + 行内删除
  - Alembic 迁移 004 — `auto_rating_rules` 表
- **网页端图片导入** — 通过管理界面批量导入图片（之前仅限 Bot）。
  - `POST /api/tasks/web-import` — 管理员 session 认证（非 API key），每个 URL 作为 ARQ 任务入队
  - `/admin/import` — URL 文本框（每行一个），每个 URL 显示状态
  - 导航栏"导入"图标链接（管理员可见）
- **管理员导航扩展** — 导航栏显示图标：管理、自动评级规则、导入图片、修改密码、退出

### 变更
- **登出跳转首页** — 登出按钮从 form POST 改为 JS `fetch()`，清除 cookie 后跳转 `/`。
- **修改密码图标** — 替换错误的"tag"SVG 图标为 HeroIcons "lock-closed" 图标。

### 修复
- **非 safe 帖子标签可见性泄露** — 匿名用户之前能看到包含非 safe 帖子的标签名、分类和 `post_count`，可推断隐藏内容。现在：
  - 匿名用户 tag `post_count` 通过子查询动态计算，仅统计 safe 帖子
  - safe 帖子为 0 的标签在列表/标签云/自动补全中完全隐藏
  - 单个标签详情对匿名用户返回 404（如果 safe 帖子为 0）
  - 管理员照常看到完整 denormalized `post_count`

### 安全
- 标签端点现在遵守管理员/非管理员可见性边界
- 自动评级规则只升级评级（永不降级），防止意外公开 NSFW 内容

## [0.1.3-pre2] - 2026-06-20

### 新增
- **`ADMIN_PASSWORD` 环境变量** — 首次启动时创建管理员的可配置密码。为空时使用随机密码打印到日志。
- **`backend/scripts/reset_admin_password.py`** — 重置管理员密码为配置的 `ADMIN_PASSWORD` 环境变量值。
- **Astro `allowedHosts` 自动检测** — `astro.config.mjs` 在未设置 `APP_DOMAIN` 时自动从 `APP_URL` 提取主机名。

### 变更
- **Footer 版本标签** — 移除冗余"Version"文本，仅显示 `{gitTag}`。
- **`infra/.env.example`** — 更新 `PUBLIC_S3_EXTERNAL_URL` 文档，说明不应包含 `/i/` 路径段。
- **`docker-compose.yml`** — 镜像标签升级到 `v0.1.3-pre2`。

### 修复
- **管理后台评级修改不生效** — `admin/posts.astro` 内联 `<script is:inline>` 包含 TypeScript 语法（`as`、箭头函数、模板字面量），Astro 不编译 `is:inline` 脚本。转为纯 ES5 JavaScript。同时添加即时视觉反馈（评级徽章修改后立即更新）。
- **`infra/scripts/build.sh`** — 修复 `PROJECT_ROOT` 路径从 `../..` 改为正确层级。

### 安全
- 管理员 `PATCH /api/posts/{id}` 端点对未认证请求返回 403。评级修改需要有效的管理员 session cookie。

## [0.1.3-pre1] - 2026-06-20

### 新增
- **内容评级系统** — 帖子新增 `safe`/`questionable`/`explicit` 评级（对齐 Danbooru）。匿名访客仅看 safe 帖子；管理员登录解锁全部评级。
  - `Rating` 枚举和 `rating` 列（Alembic 迁移 002）
  - Pixiv `x_restrict` 和 Danbooru `rating` 元数据自动映射
  - 所有列表/详情/搜索端点按评级过滤匿名用户
  - `rating:safe`/`rating:q`/`rating:e` 搜索语法（管理员）
- **管理员认证** — 单管理员登录 + 签名 cookie session
  - `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/status` 端点
  - `POST /api/auth/change-password` — 首次登录后修改密码
  - `backend/app/auth.py` — itsdangerous 签名 cookie + bcrypt 密码验证
  - 管理员凭据存储在 `admins` 数据库表中
  - 首次启动自动创建管理员，随机密码打印到日志
- **API key 鉴权** — `POST /api/tasks/` 和 `POST /api/rebuild/` 现在需要 `X-Api-Key` 头匹配 `BACKEND_API_KEY`
- **Danbooru 风格标签侧栏** — 详情页按分类分组显示标签（Copyright → Character → Artist → General → Meta）
- **评级徽章和管理员编辑** — 帖子显示彩色评级徽章（S/Q/E），管理员可在详情页直接修改评级
- **管理后台** — `/admin/posts` 列出所有帖子（含非 safe），行内修改评级 + 筛选
- **登录页** — `/login` 用户名/密码表单
- **管理模式指示器** — 顶部横幅"🔒 管理模式"
- **导航栏认证控件** — 登录/登出/管理链接
- **404 页面** — 正确的 404 页面
- **中间件** — Astro 中间件从 cookie 解析管理员 session，注入 `isAdmin`/`ssrCookie`
- **`admins` 数据库表** — Alembic 迁移 003

### 变更
- **前端 API 客户端** — `fetchApi` 转发 SSR cookie 头到后端；所有 fetch 函数接受 `ssrCookie` 参数
- **Post detail** — 重新设计为 Danbooru 三栏布局（标签侧栏 + 图片 + 信息侧栏）
- **BaseLayout** — 读取 `Astro.locals.isAdmin` 显示管理员/登出/登录导航项
- **`.env.example`** — 新增 `ADMIN_USERNAME`、`ADMIN_SESSION_MAX_AGE`、`BACKEND_API_KEY`；移除 `ADMIN_PASSWORD_HASH`

### 移除
- `ADMIN_PASSWORD_HASH` 环境变量 — 管理员凭据改存 `admins` 数据库表
- `backend/scripts/generate_password_hash.py` — 不再需要

### 安全
- `POST /api/tasks/` 和 `POST /api/rebuild/` 需要 `X-Api-Key`
- 非 safe 帖子对匿名用户返回 404（隐藏存在性，非 403）
- 管理员 session cookie 为 HttpOnly、Secure（生产环境）、SameSite=Lax

## [0.1.2] - 2026-06-19

### 新增
- **标签分类系统** — Pixiv/Danbooru 来源标签正确分类为 artist/character/copyright/general/meta，不再全部归为"general"。
  - `tag_categories` 字段从 gallery-dl 元数据 → Pydantic schema → 数据库
  - Danbooru `tag_string_*` 字段映射到 `TagCategory` 枚举
  - Pixiv `user.name` 自动提取为 artist 标签
  - 分类升级逻辑：源数据提供更好分类时升级现有"general"标签
- **Bot 转发消息支持** — Bot 正确处理包含图片 URL 的转发 Telegram 频道消息。
- **HTML 描述渲染** — Pixiv 作品描述中的 HTML（超链接、格式化）在前端正确渲染。
  - 后端：`bleach` 库消毒 HTML（允许安全标签）
  - 外部链接自动添加 `target="_blank"` + `rel="noopener noreferrer"`
  - 前端：`set:html` 指令渲染消毒后的 HTML

### 变更
- **后端依赖**：新增 `bleach` 用于 HTML 消毒
- **Bot 处理器架构**：`url_handler.py` 拆分为文本/图片+标题/共享辅助函数
- **docker-compose.yml**：所有服务更新到 v0.1.2 镜像

### 修复
- **AuthMiddleware 转发 bug**：转发消息 `from_user.id` 为频道 ID（负数），导致认证失败。改用 `chat.id`。
- **标签分类为空**：所有标签硬编码为 `general`。现在从源元数据正确分类。
- **HTML 描述被转义**：原始 HTML 渲染为文字。现在消毒后渲染为可点击链接。

### 安全
- HTML 描述服务端消毒防止 XSS
- 外部链接标记 `rel="noopener noreferrer"`

## [0.1.1] - 2026-06-19

### 新增
- `infra/scripts/build.sh` — 统一 Docker 镜像构建脚本，注入版本标签到前端 footer。
- `CHANGELOG.md` — 版本历史追踪。

### 变更
- **前端版本显示**：`BaseLayout.astro` footer 从 Docker build arg 读取 `PUBLIC_GIT_TAG`，不再硬编码。
- **日期显示**：详情页"添加时间"使用浏览器默认区域设置，不再硬编码 `ja-JP`。

### 修复
- 前端 `package.json` 版本从 `0.0.1` 升级到 `0.1.1`。
- 中国构建镜像源记录在 `CLAUDE.md`。
- Redis 空密码 `--requirepass` 解析问题记录。
- `schemas/__init__.py` 过期导入崩溃记录。
- Caddy `/i/*` S3 代理配置备注添加。

## [0.1.0] - 2026-06-18

### 新增
- 完整处理流水线：Telegram Bot → 后端 API → ARQ Worker → gallery-dl → S3 存储。
- 前端：Astro SSR + Tailwind v4，瀑布流网格，标签系统，搜索，分页。
- Bot：URL 自动检测，`/save`、`/info`、`/search` 命令。
- 基础设施：Docker Compose，Caddy 反向代理，MinIO/R2 S3。
- 感知哈希（phash）去重，前缀桶索引。
- Pixiv、Twitter/X、Danbooru 源提取器 + 通用回退。
- 图片流水线：HEAD 大小检查 → 下载 → phash → 缩略图/预览生成 → S3 上传。
- 标签系统，5 类分类（artist、character、copyright、general、meta）。
- `/api/search` 支持标签组合搜索（`+`）和排除（`-tag`）。
- `/api/tags/autocomplete` 搜索栏自动补全。
- Caddy Souin 缓存层（5 分钟 TTL）。

### 变更
- **架构决策**：SSR + Caddy 缓存（非 SSG），因为 SSG 不支持增量重建。
- **图片服务**：直接从 S3/CDN，不经 Caddy 代理。
- **S3 抽象**：通用 S3 兼容层 — 仅通过环境变量切换提供商（R2/MinIO/AWS S3）。

### 安全
- phash 值永不暴露在 API 响应中。
- `BOT_ADMIN_IDS` 统一中间件认证所有 Bot 命令。
- 多阶段 Dockerfile，基础镜像固定版本。

### 基础设施
- 多阶段 Dockerfile（`dev` / `builder` / `runner`）。
- 流式 S3 上传（无内存缓冲）。
- S3 key 规范化 + 上传后 URL 验证。
- Alembic 迁移中显式数据库索引。
- 数据库迁移脚本（`migrate-db.sh`、`validate-env.sh`）。
