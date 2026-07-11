# 变更日志

本文件记录项目的所有重要变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.7.5] - 2026-07-11

### 修复
- **`artist:` 前缀标签去重** — `fix-artist-categories` 之前对带 `artist:` 前缀的标签只做"改名"，遇到 clean 同名标签已存在时因 unique 约束失败被跳过（漏网鱼，如 `artist:みこフライ`）。改为两路处理：(a) clean 同名标签已存在 → 把 prefixed 标签的 `post_tags` 关联迁移到 clean 标签（跳过已重叠的 post，PK 兜底），确保 clean 标签 `category=artist`，删除 prefixed 标签（剩余重叠行级联删除）；(b) 无 clean 同名 → 原地改名 + 设 `category=artist`。幂等：二次运行找不到 `artist:%` 行。返回值改为 `merged_into_clean` / `renamed_in_place` / `posts_moved` 三段计数，前端 `TagsPanel` 提示同步。当前生产库 19 条 prefixed 标签全部有 clean 同名，dry-run 显示迁移 36 条 `post_tags`、0 重叠、clean 标签全转 artist。

## [0.7.4] - 2026-07-11

### 修复
- **NODE_ENV 防回归双重守卫** — 0.7.3 (`f3be09a`) 已在 Dockerfile `build` 阶段补 `ENV NODE_ENV=production` 修复 dev 包根因，但单点修复若被误删仍会静默复发。新增双重守卫：(1) `docker-publish.yml` build-push 前新增 `Assert production build guard` step，grep Dockerfile 缺该 ENV 即失败；(2) build 阶段内 `RUN test "${NODE_ENV:-}" = "production"` 兜底，缺失即 `FATAL` 退出。同步 `CLAUDE.md` / `docs/development.md` 的 Common Pitfalls，强调 bump 版本的正确流程是一次 `pull && up -d`，别盲目重跑。
- **docker-compose 数据卷改 bind mount** — `postgres_data` / `redis_data` named volume 改为宿主机 `/data/postgres` / `/data/redis` bind mount，便于备份与运维；移除 `volumes:` 顶级声明。

## [0.7.3] - 2026-07-09

### 修复
- **构建期 devtools 泄漏根因修复** (`f3be09a`, LAI-23) — `@nuxt/devtools` 是否打进客户端 bundle 由 `devtools.enabled` 决定，该值在 Nuxt schema-parse 时读 `process.env.NODE_ENV`。node:22-alpine 基础镜像在 `npm run build` 时 `NODE_ENV` 未设置，导致 `NODE_ENV !== 'production'` 恒为真，每次 bump 版本后 devtools 都被打进 prod 客户端包（网页出现 dev 标）。在 Dockerfile `build` 阶段补 `ENV NODE_ENV=production`（production 阶段虽也设，但构建期值才 gate 客户端构建）。`nuxt.config.ts` 注释同步真实根因。
- **移除首页 column-span 置顶卡片** (`3682e8d`, LAI-23) — v0.7.2 工序4 在首页 gallery 第一页加了 `column-span:all` featured 卡片，桌面端全宽图读起来像"顶图过大"。从 `PhotoGrid`/`PhotoCard` 删除 `featured` opt-in prop，`index.vue` 不再传，删除 `.masonry-featured` CSS。gallery 恢复统一 masonry 网格。
- **恢复详情页三栏布局** (`ca02eb3`, LAI-23) — v0.7.2 工序4 把详情页三栏（左 tags / 中图 / 右 info）改成沉浸式单栏堆叠，桌面不再是三栏。恢复 `lg:flex-row` 三栏 + sticky 侧栏 + 移动端 pill+card 堆叠；按钮统一用 `.btn-primary` / `.btn-danger` 设计 token。

## [0.7.2] - 2026-07-09

### 新增

- **视觉与体验升级 — Theme 工序 1-6（LAI-19）** — 基于 `docs/theme-design.md` 的设计规范，六道工序全量落地：
  - **工序1 CSS 变量微调** — `--radius-chip=0` 与设计稿 Token 清单对齐。
  - **工序2 动画系统升级** — 图片 `blurReveal` stagger 60ms 替代旧 cardIn；搜索结果计数 `countUp` 0.2s 延迟；统一的叙事顺序（图片→文字→标签）。
  - **工序3 组件视觉升级** — TagBadge 加 `--category-color` 分类色竖条，hover 显示翻译；Pagination 选中态改为 accent 下划线；新增 `.btn-primary` / `.btn-ghost` / `.btn-danger` 三层按钮体系；SearchBar 建议项加分类色竖条。
  - **工序4 布局重构** — PhotoGrid 首页第一张卡 `featured`（column-span:all 跨列 + 高度上限）；详情页三栏 → 沉浸式堆叠（图全宽 + 标签/信息滚动到下方 + 顶栏快速跳转按钮）；导航极简化（logo + 大搜索框 + 主题/强调色 + `...` 溢出菜单，滚动 >100px 收缩 56→44px）；标签页表格→标签星座图（展示字体 + 分类色文字 + hover 显示翻译/danbooru_name）；搜索页无查询时 60% 居中搜索框 + 最近搜索 + 热门标签 Top10。
  - **工序5 交互增强** — `←` `→` 键在画廊/标签/搜索页翻页；最近搜索通过 localStorage 存储（`kura-recent-searches`）；新增 `fetchPopularTags` API。
  - **工序6 字体系统** — `@font-face KuraDisplay`（`font-display:swap`），字体文件缺失时静默回退系统 CJK 栈；`--font-display` 前置 KuraDisplay / HarmonyOS Sans / Source Han Sans。

- **Sharp 管线迁移（LAI-20 / PR #12）** — 将剩余 Python sidecar 图像元数据处理迁移到 Node sharp pipeline：
  - Sharp 通过 `img.metadata()` 重新推导 width/height/mime，Post insert 和 S3 ContentType 使用探测值，sharp 不可用时回退 Pillow 值。
  - 修复 description 被 sidecar 提取但从未写入 DB 的静默 bug。
  - 记录 phash 继续留在 imagehash（不迁移）的决策原因：sharp/libvips 与 Pillow Lanczos 子像素差异导致 phash 漂移 6-14 Hamming bits，达到/超过去重阈值 8，迁移会破坏跨时代去重。

### 变更

- **`docs/roadmap.md`** — 更新已完成项目。
- **`infra/.env.example`** — `KURA_VERSION` 升级为 `v0.7.2`。
- **`PhotoGrid.vue`** — `featured` 改为显式 opt-in prop，不再从 `currentPage` 派生，修复搜索页/标签页第一张卡永久跨列。

### 修复

- **PhotoGrid 跨列泄露** — `/search` 与 `/tags/[name]` 未传 `currentPage` 导致默认值 1 触发 `featured` 计算属性，所有列表页第一张卡永久 `column-span:all`。改为显式 `featured` prop + 首页传 `:featured="page === 1"`。

## [0.7.1] - 2026-07-07

### 新增
- **AI 助手** (`server/utils/ai.ts`) — 管理后台新增 `/ai` 标签页，对作品做摘要 / 评级建议 / 标签分类建议（OpenAI 兼容 API）。Bot 新增 `/ai`、`/aitags` 命令，`/info` 附带作品摘要，轮询通知中给出评级建议。新增 `AiStatus`、`AssistantSuggestion`、`AssistantReply`、`RatingSuggestionItem`、`TagClassificationSuggestion`、`MergeSuggestion` 类型。
- **Artist 标签字段化** — artist 从普通标签提升为独立字段，sidecar 抓取 → pipeline → DB 全链路贯通；一次性修复历史错误归类的 artist 标签；标签别名 CRUD + 重处理流程。
- **新 Logo / favicon** — 扇形三卡设计替代字母标。
- **LQIP 低质量图像占位符** — 入库时由 sharp 生成 20×20 webp (cover + blur(2) + q40) 缩略图，编码为 base64 数据 URI 嵌入 API 响应。列表卡片/详情页在原图加载前先渲染模糊 LQIP 占位，消除灰底闪烁。
  - `posts.lqip` 列（drizzle 迁移 0001）
  - `server/utils/pipeline.ts` 在缩略图生成后同步产出 `lqipDataUri`
- **图片模态框 pan/zoom** (`ImageModal.vue`) — 详情页点击图片打开全屏模态框，支持鼠标滚轮缩放 (0.5×–8×)、双击切换 2×/复位、按住拖拽平移、双指捏合缩放（触屏）、点击/ESC 关闭。`defineModel<boolean>` 双向绑定可见状态，Teleport 至 body 避免 z-index 层叠问题。
- **全局键盘快捷键** (`useKeyboardShortcuts.ts`) — 布局级一次性挂载，输入元素聚焦时自动防御。
  - `J` / `K` — 详情页下一个 / 上一个作品（按当前列表上下文）
  - `/` — 聚焦搜索框
  - `G` 然后 `T` — 跳转标签列表
  - `?` — 打开快捷键速查表
- **`Kbd.vue` 平台感知键盘提示** — 自动根据 `navigator.platform` / cookie 渲染 ⌘ (mac) 或 Ctrl (其他)，配套 `usePlatform.ts` SSR 防闪烁（cookie + head 内联脚本）。
- **`KbdCheatSheet.vue` 速查表** — `?` 触发的模态框，列出全部快捷键 + 平台对应键帽。
- **搜索框 ⌘K 聚焦** — `SearchBar.vue` 显示 `⌘/Ctrl+K` 键帽芯片，按下自动聚焦输入框。
- **滚动位置记忆** (`app/router.options.ts`) — `scrollBehavior` 配合 sessionStorage 在列表 ↔ 详情页来回导航时恢复瀑布流滚动位置，避免回到顶部。
- **Extension 测试覆盖** (`extension/tests/`) — vitest 套件覆盖 service-worker / content / popup 三个入口的导入流程（config 缺失、401、非 ok HTTP、网络错误、轮询终态、超时守卫、设置持久化等），从 1 个无断言 smoke 测试提升到 31 个真实测试。引入 jsdom 执行 ES5 content/popup 脚本。
- **Sidecar SSRF 守卫测试** (`sidecar/tests/test_ssrf.py`) — 16 个纯函数测试覆盖 `validate_url` / `_is_blocked_ip`（scheme 策略、缺失 host、RFC1918 / link-local / loopback / ULA / cloud-metadata 拦截），<1s 运行。

### 变更
- **镜像 tag 策略统一** (LAI-9) — 生产部署通过 `KURA_IMAGE_TAG` 在 `.env` pin 一个 release tag（如 `v0.7.1`），`:latest` 仅用于 dev/rolling。所有 compose 调用必须带 `--env-file ../.env`（`env_file:` 只注入容器变量，不喂 `${VAR}` 插值，否则静默回退 `:latest`）。`.env` 默认位于项目根目录，`validate-env.sh prod` 拒绝空的 `KURA_IMAGE_TAG`。`docs/versioning.md` / `rollback.md` / `operations.md` / `deployment.md` / `CLAUDE.md` / compose 头部全部同步。
- **CI workflow 重构** — `ci.yml` 改用 npm 缓存 + `nuxt typecheck`（非 nuxi），删除 vitest 忽略的 `COVERAGE_THRESHOLD`、停止把 sidecar pytest 失败伪装成通过（`|| echo`），拆分 job 让失败可归因；`build-extension.yml` 修正包名（resvg → resvg-cli）、加 concurrency + artifact retention、校验 `workflow_dispatch` ref 防注入；`docker-publish.yml` 仅放行 `v*` release tag，移除会与 `:latest` 语义漂移的 `latest-<timestamp>` tag，恢复 `delete-only-untagged-versions=true`（绝不删除仍被部署拉取的 tagged 版本），cleanup 以 build 成功为前置。
- **`PhotoCard.vue`** — 卡片改为 `NuxtLink` 包裹 + `@click` preventDefault 打开模态框；新增 `currentPage` / `listParam` 属性以构建详情页返回上下文。
- **`PhotoGrid.vue`** — 接收并透传 `currentPage`，计算 `listParam` 供卡片使用。
- **`app/pages/posts/[id].vue`** — pan/zoom 状态机抽出到 `<ImageModal>` 组件；LQIP 优先占位回退到 thumb；挂载 `useKeyboardShortcuts`（J/K 导航 + navList）。
- **`app/layouts/default.vue`** — 挂载 `usePlatform` / `useKeyboardShortcuts` / `KbdCheatSheet`，双向同步 cheatsheet 开关状态。
- **`docs/roadmap.md`** — 移除已完成的 sharp/LQIP/模态框/键盘/滚动条目，更新长期愿景。

### 修复
- **全栈安全审计** — 服务端：导出 `parseSession`/`SESSION_MAX_AGE` 并停止缓存 Redis-down fail-open；改密端点用共享 `parseSession`（原缺 MAX_AGE 检查）；login cookie maxAge 与 session MAX_AGE 对齐（原 30d vs 7d）；`test-pg`/`test-redis` DNS pinning 防 rebinding SSRF；webhook 生产环境缺 `BOT_WEBHOOK_SECRET` 时拒绝；bot-rating 内部 PATCH 补 `x-api-key`（原静默 401）；`posts/[id].patch` 用 `.returning()` 替代 update+select 竞态；扩展源 CORS 不再带 `Allow-Credentials`；`i/[...]` 改为流式转发 S3 响应（原全量缓冲进内存）；SSE 流 `JSON.parse` 包 try/catch（一条坏结果不再杀死整个流）；`sanitize.ts` 改为 escape-first allowlist（原 regex sanitizer 可绕过）。前端：生产关闭 devtools（原移动端可见）；移除硬编码 `htmlAttrs.class='dark'`（SSR 主题闪烁）；`AnnouncementBanner` 全重写（Vue 模板 + XSS-safe markdown + 清理 timer/listener）；`index/search` 的 `perPage` 由 `let` 改 `computed`（URL 变化不重新 fetch）；`ImageModal` mousemove/mouseup 挂 window + `role=dialog`；多个组件补 `onUnmounted` 清理 listener/timer/EventSource。CI：删除不存在的 lint job、extension-tests 补 `npm ci`、drop `--coverage`；`.dockerignore` 入库。维护模式关闭时 `/maintenance` → `/` 重定向。
- **Typecheck 142→0** — 用 `BotContext extends Context` flavor + `Bot<BotContext>` 替代会遮蔽 grammy 真实导出的 ambient `declare module 'grammy'`（删除 `server/types/grammy.d.ts`）；handler 参数全量类型化；窄化 `ctx.callbackQuery.data` 与数组下标（`noUncheckedIndexedAccess`）；`redis.set()` 改用 `{ expiration: { type: 'EX', value } }`（v6 签名无位置参数）。顺带修两个真 bug：`change-password.post.ts` 引用未定义的 `bcryptjs`（运行时 ReferenceError）→ 改用共享 `verifyAdminPassword()`；`ai.ts` 的 `isNull` 未定义 → `import { isNull } from 'drizzle-orm'`。前端无 `as` cast 修 `noUncheckedIndexedAccess`。`npx nuxt typecheck` exit 0。
- **P1–P7 评审** — `[id].vue` 内联 80 行 pan/zoom 状态机抽到 `<ImageModal>` 组件（P1）；`onUnmounted` 复位 `isDragging` 防泄漏（P2）；`onWheel` 以鼠标位置为锚点缩放（P3）；`SearchBar` ⌘K title 动态化（P5，原硬编码 `/ 聚焦搜索`）；`KbdCheatSheet` 改 `defineModel`（P6，原 props+emit 拆分）；`useKeyboardShortcuts` / focuses 走 `querySelector`（P7，无 ref 线程化）。
- **Extension tsconfig** — vitest 4 的 oxc parser 加载 `.test.ts` 需要 tsconfig，否则 `[TSCONFIG_ERROR]` 让 extension-tests CI 常红。新增仅覆盖 `tests/` + `*.config.ts` 的最小 tsconfig（不继承根 Nuxt tsconfig 的 references 结构）。
- **delete 端点假错** — 204 No Content 触发 `.json()` `SyntaxError`，删除看似失败实则成功。改用状态码判断。
- **head_inject 嵌套 script** — innerHTML 包裹 `<script>` 产生浏览器无法解析的嵌套标签。解析 `head_inject` HTML 抽取 script 属性供 `useHead` 渲染。
- **Tag UUID 复制按钮** — `TagIdTooltip` prop 不匹配（`:id` vs `tagId`）致 UUID 从未传入。重做为带剪贴板图标的可见复制按钮。
- **Sidecar artist tag 取错字段** — gallery-dl 把 screen_name 存在 `user['name']`、显示名存在 `user['nick']`，原取 `name` → artist 标签显示成 `@226083260Bubai`。改为取 `nick`。
- **SFC `<script>` 转义** — regex 内裸 `<script>` 与模板字面量内 `</script>` 触发 Vue 解析错误，分别避免 / 转义。

## [0.7.0] - 2026-07-02

### 新增
- **Nitro/Nuxt 4 全栈重写** — 替代 Astro (前端) + FastAPI (后端) + aiogram (Bot) 三进程架构为单一 Node 进程。SSR + REST API + Bot webhook 由 Nitro 同进程处理。Python 仅保留 sidecar（gallery-dl + phash）。
- **Telegram Bot 重写** — aiogram (Python) → grammy (TypeScript)，webhook 模式在 Nitro 进程内运行。i18n 中/英双语，/search /random /stats /autopass /lang /info /save 命令，inline keyboard 评级选择 + 10s 倒计时自动确认。
- **管理后台仪表盘** — 环形图（来源分布）+ 分段色条（评级分布）+ 热门标签云 + 系统状态实时轮询。6 个子标签页全部 Material Design 风格重设计。
- **字体统一** — `system-ui` + `PingFang SC` + `Microsoft YaHei` + `Hiragino Sans GB` 单一系统栈，零外部加载。
- **Docker 镜像版本刻入** — `KURA_VERSION` build arg 在构建时写入 Nuxt runtimeConfig，footer 永远显示正确版本号。
- **SSRF 防护** — sidecar URL 校验（scheme + IP 黑名单）+ IPv4-mapped IPv6 归一化 + redirect hop 重校验 + max-redirects 限制。
- **公告横幅** — 铃铛图标 + 行高对齐优化，Markdown 内联渲染，sessionStorage 关闭记忆。

### 变更
- **项目目录扁平化** — `nuxt-app/*` → 根目录。删除 `backend/` `frontend/` `bot/` 旧版代码。
- **容器重命名** — `kura-nuxt` → `kura-web`，`kura-sidecar` → `kura-worker`。删除 `docker-compose.dev.yml`。
- **清除所有 "v2" 字眼** — 镜像名、环境变量、文档、注释。`DATABASE_URL_V2` → `DATABASE_URL`。
- **README 恢复** — 居中 logo + badges + 特性列表样式。
- **主题切换 auto 图标** — 虚线圆 → 显示器图标（🖥），清晰表达"跟随系统"。
- **调色按钮图标** — 纯色圆点 → 调色盘 SVG。

### 修复
- **grammy API**: `bot.hear` → `bot.hears`
- **redis v6**: Proxy 命令名小写 → 大写（`LPUSH`/`BRPOP`/`GET`）
- **gallery-dl 1.32**: `config.set()` tuple → 3-arg；`DownloadJob` 移至 `gallery_dl.job`；metadata 从 `pathfmt.kwdict` 读取
- **BRPOP 死锁**: pipeline worker 独立 Redis 连接，避免阻塞共享连接导致登录后 SSR 挂起
- **Head inject 响应式**: `useHead(() => ...)` getter 模式，设置变更后自动生效
- **pie/bar chart 渲染**: `count` 字符串→数字转换；SVG `fill="var(--bg-*)"` → `style`
- **`.claude/` `.serena/`**: 加入 `.gitignore`

### 移除
- 旧版 Python backend（FastAPI + SQLAlchemy + ARQ）
- 旧版 Python bot（aiogram）
- 旧版 Astro frontend（React islands + shadcn/ui）
- `docker-compose.dev.yml`
- `docker-compose.v2-dev.yml`

## [0.6.3] - 2026-06-27

### 新增
- **Astro ClientRouter (View Transitions)** — 全站页面切换过渡动效。导航不再全页重载，改为 SPA 式平滑 cross-fade + 轻量 pageIn 入口动画。
  - `transition:persist` 持久化：footer、公告横幅（保持关闭状态）、AccentPicker/ThemeToggle（保持 React 状态）、移动端菜单（保持开/关状态）
  - 导航栏不 persist（确保 admin/login 链接始终反映当前认证状态）
  - 移动端菜单脚本改为事件委托（兼容 View Transitions DOM swap）
- **Bot `/random` 命令** — 获取随机作品，调用 `GET /api/posts/random`
- **Bot `/stats` 命令** — 显示全站统计（作品数/标签数/关联数/存储量），调用 `GET /api/admin/dashboard/`
- **Bot `/start` 更新** — 欢迎信息列出所有命令（含 /random 和 /stats）

### 变更
- **页面入口动画减轻** — `pageIn` 位移 12px→6px，时长 350ms→200ms；卡片交错 40ms→25ms 间隔（总时长 440ms→275ms），导航时不再感觉"等卡片飞完"
- **设置传播提效** — 前端中间件缓存 TTL 30s→10s，后端 Redis 缓存 TTL 300s→60s。维护模式/公告修改后最迟 10s 生效
- **分页触控目标增大** — 页码/翻页按钮 36px→40px，每页选择器 padding 增大
- **刘海屏安全区域** — viewport `viewport-fit=cover` + body `env(safe-area-inset-*)` padding
- **首页移动端搜索框** — 小屏时全宽（`w-full sm:max-w-[280px]`）
- **依赖升级** — `fastapi>=0.115`，`lucide-react` 0.511.0（修复 icons 构建问题）
- **Docker 镜像标签** — 升级为 `v0.6.2-dev`

## [0.6.1] - 2026-06-27

### 新增
- **移动端主题控件修复** — AccentPicker 和 ThemeToggle 从 `hidden md:flex` 桌面独占 div 移至始终可见的独立区域，所有屏幕尺寸均可操作
- **管理后台响应式重设计** — 图片表格：桌面表格 + 移动端卡片布局；移动卡片展示缩略图、标题、来源、评级、操作按钮
- **主题同步（多实例）** — AccentPicker 派发 `kura-accent-change` CustomEvent，ThemeToggle 派发 `kura-theme-change` CustomEvent，同一页面多实例实时同步
- **Docker 构建优化** — backend/bot/frontend 各自添加 `.dockerignore`；`PYTHONDONTWRITEBYTECODE` + `PYTHONUNBUFFERED` 环境变量；`pip install --no-compile` + 清理 tests/pip/setuptools/wheel 缓存；前端多阶段构建 + node_modules 缓存层

### 变更
- **Docker 镜像标签** — 升级为 `v0.6.1`
- **标签页卡片适配** — 移动端标签列表改为紧凑卡片形式
- **标签云触控优化** — 触屏设备标签覆盖层始终可见（`@media (hover: none)`）

## [0.6.3] - 2026-06-27

### 新增
- **管理后台仪表盘** (`/admin?tab=dashboard`) — 4 张概览卡（作品总数 / 标签总数 / 关联总数 / 存储总量）+ 2 张分布图（来源 / 评级横向 bar）+ 2 张榜单（热门标签 TOP 10 / 最新作品 6 张缩略图）。默认 tab 改为 dashboard，进管理后台直接看到全站总览。
  - `GET /api/admin/dashboard/` — admin only，单请求聚合 8 个指标（4 COUNT + 2 GROUP BY + 2 LIMIT）
  - 4 个新 Pydantic schema（`OverviewStats` / `SourceBreakdownItem` / `RatingBreakdownItem` / `TopTagItem` / `RecentPostItem` / `DashboardResponse`）
  - 纯 SQL 聚合，无缓存层（admin 专属低频访问）
  - 空数据正常渲染（0 不崩溃）；匿名返回 401
- **标签 ID 复制浮泡** — admin 标签列表中 UUID 列从「原生 title 提示」升级为「hover 200ms 显示完整 UUID + 点击复制按钮」。Clipboard API 优先，textarea + execCommand 降级。浮泡自身 `user-select: all` 作为终极降级（手动全选复制）。
- **标签合并重写** — `POST /api/admin/tags/merge` 端点完全重写：
  - `target.post_count` 改用 `SELECT COUNT(*) FROM post_tags WHERE tag_id = target` 重新计算，作为 single source of truth（替代旧的「累加 moved」方式）
  - 2 次批量查询（source/target post_ids）替代 N+1 循环
  - 行级锁 `with_for_update=True` 序列化并发合并
  - 单次 commit，失败回滚整个事务
  - 新增 `TagMergeResponse` schema：`target_old_post_count` / `target_new_post_count` 让 UI 能显示合并前后对比
  - 删除死代码 `source.post_count = 0`（紧随 `db.delete(source)`，无意义）

### 变更
- **管理后台默认 tab** — 从「图片」改为「概览」。子标签「管理」组首位新增「概览」。
- **合并确认弹窗** — 文案增强，显示源/目标 ID（防止误操作）。成功弹窗显示「合并前 / 合并后 post_count」对比，admin 可立即确认 `post_count` 是否真的对上了。
- **前端合并 tags 类型** — `mergeTags` 响应类型从 `source_tag` / `target_tag` 改为 `source_tag_id` / `source_tag_name` / `target_tag_id` / `target_tag_name`（与新后端 schema 对齐）。
- **管理后台 sub-tab 路由** — `admin/index.astro` `manageGroup` 内联 JS 数组加入 `dashboard`，子标签栏 visible 条件更新。
- **`docs/architecture.md`** — API endpoints 表追加 `/api/admin/dashboard/`；`merge` 端点描述补「verified post_count」。

### 修复
- **标签合并 post_count 漂移** — 旧实现 `target.post_count = target.post_count + moved` 仅累加「新增」关联，未考虑被删除的重复项；多次串联合并后 `post_count` 会偏离真实关联数。新实现用 `COUNT(*)` 重算，与实际 `post_tags` 行数严格一致。

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
