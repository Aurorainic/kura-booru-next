# 前端审计报告 · kura-booru-next（v0.9.0 分支，基准 v0.8.1）

> 审计范围：`app/`（pages/components/composables/layouts/types/router.options/error）、`assets/css/`、`package.json`、`nuxt.config.ts`、`tsconfig.json`。
> 前端代码总量：**app/ ≈ 6,769 行**（含空行/模板/样式），其中 Vue SFC 约 6,000 行，composables/types 约 900 行；`assets/css/main.css` 733 行。共 10 个页面、33 个组件、9 个 composable。
> 审计方式：逐文件通读（非抽样）。

---

## 1. 技术栈现状清单

### 1.1 依赖（package.json）

| 类别 | 依赖 | 版本 | 说明 |
|---|---|---|---|
| 框架 | `nuxt` | ^4.4.8 | Nuxt 4，`compatibilityDate: '2025-07-15'` |
| 视图 | `vue` | ^3.5.38 | 全部 `<script setup lang="ts">` |
| 路由 | `vue-router` | ^5.1.0 | 由 Nuxt 驱动，另有 `app/router.options.ts` 自定义 scrollBehavior |
| 样式 | `tailwindcss` + `@tailwindcss/vite` + `@tailwindcss/postcss` | 4.3.2 | Tailwind v4，**经 Vite 插件接入**，非 `@nuxtjs/tailwindcss` 模块 |
| 其他（实为服务端） | drizzle-orm / postgres / redis / sharp / @aws-sdk/* / grammy / bcryptjs / dotenv / isomorphic-dompurify | — | 均只在 server 侧使用（dompurify 见 `server/utils/sanitize.ts`，前端无引用） |

**关键结论：前端第三方依赖 = 零。** 没有 Pinia、没有 VueUse、没有 UI 组件库、没有日期/图片/虚拟滚动工具库。所有交互（pan/zoom/pinch、SSE、轮询、公告轮播、toast、confirm）全部手写。

### 1.2 nuxt.config.ts 关键配置（63 行）

- **SSR**：未声明 `ssr: false`，即默认全站 SSR（universal rendering）。
- **模块**：`modules` 字段完全缺失——**零 Nuxt 模块**（无 @nuxt/image、无 @nuxtjs/color-mode、无 @pinia/nuxt）。
- **CSS**：`css: ['~/../assets/css/main.css']`，Tailwind 通过 `vite.plugins: [tailwindcss()]` 注入。
- **runtimeConfig**：`internalApiUrl`（SSR 内网 API 地址，默认 `http://127.0.0.1:3000/api`）；public 下 `gitTag` / `repoUrl` / `enableAiTagProcessing`。
- **routeRules**：`/admin/**`、`/login`、`/logout` 强制 `private, no-store`；注释明确**禁止**重新加 `swr`（v0.7.2 的 cookie-key 泄漏事故教训，nuxt.config.ts:42-58 有完整 ponytail 注释）。SSR HTML 缓存由 `server/middleware/02-cache-control.ts` 按 cookie 区分 anon（CDN 可缓存 300s）/ admin。
- **head**：`lang: zh-CN`、`theme-color: #7DD3C0`、SVG favicon。
- **devtools**：显式 `enabled: process.env.NODE_ENV !== 'production'`（Docker 构建期 NODE_ENV 兜底，注释见 nuxt.config.ts:6-10）。

### 1.3 tsconfig.json

仅 `references` 到 `.nuxt/tsconfig.*.json`（Nuxt 4 标准四段式），无自定义 compilerOptions。

---

## 2. 页面清单与结构

所有列表页同一数据获取范式：`useAsyncData` + 动态 key + `watch` 响应 query 变化 + try/catch 兜底返回空集；SSR 时用 `ssrCookie` 手动转发 cookie（见 §5）。

| 页面 | 行数 | 职责 | 数据获取 |
|---|---|---|---|
| `pages/index.vue` | 116 | 画廊首页：分级筛选（admin）、快速搜索框、瀑布流、分页 | `useAsyncData` SSR，`fetchPosts(page, perPage, rating)`；per_page 从 query/cookie 双源解析（默认 40） |
| `pages/search.vue` | 192 | 搜索：无 query 时是"探索页"（最近搜索 localStorage + 热门标签 Top10），有 query 时结果流 + source 筛选 + 未解析标签警告 | `useAsyncData` SSR，`fetchSearch`；热门标签 `onMounted` 客户端拉取 |
| `pages/tags/index.vue` | 121 | 标签星座图（字号按 post_count 缩放 0.75–2rem，hover 出翻译） | `useAsyncData` SSR，`fetchTags(sort, category, per_page=100)` |
| `pages/tags/[name].vue` | 54 | 单标签详情 + 该标签下的图 | 两个 `useAsyncData`（tag 信息 + fetchSearch 复用搜索接口） |
| `pages/posts/[id].vue` | 317 | 详情页：三栏（左标签 / 中图 / 右信息），admin 内联编辑标签/评级/删除，LQIP→preview 渐进加载，J/K 系列内翻页 | `useAsyncData` SSR，`fetchPost`；失败 `throw createError(404)` |
| `pages/random.vue` | 85 | 随机发现：首图 SSR，之后客户端 shuffle（Space 快捷键） | `useAsyncData` SSR + 客户端 `fetchRandomPost` |
| `pages/login.vue` | 90 | 管理员登录 | 纯客户端 `login()`，成功后 `window.location.href='/'` 强制全刷（让 SSR 重读 session cookie） |
| `pages/admin/index.vue` | 132 | 管理后台壳：8 个 tab，全部 `defineAsyncComponent` 路由级分包 + `<KeepAlive>` 保活 | SSR 时 `if (!isAdmin) throw createError(403)` 在服务端就拒绝 |
| `pages/admin/import.vue` | 89 | 批量导入（URL 列表 → 任务 → SSE 进度流） | 纯客户端 `$fetch` + `EventSource('/api/tasks/web-import/stream')` |
| `pages/maintenance.vue` | 18 | 维护页 | 无数据 |
| `error.vue` | 24 | 全局错误页（404 等） | — |

补充：

- `app.vue`（5 行）只有 `NuxtLayout + NuxtPage`。
- `layouts/default.vue`（232 行）承担**大量全局职责**：从 SSR context 初始化 `isAdmin/ssrCookie/siteSettings`（layouts/default.vue:7-12）、主题/accent 双 anti-flash 内联脚本（:80-87）、`head_inject` 正则解析注入（:94-124，仅 admin 可见）、导航栏滚动收缩 + 溢出菜单、全局快捷键、Toast/Confirm 容器挂载。
- `router.options.ts`（42 行）手写滚动位置记忆：per-path 存 sessionStorage，前进滚顶、后退恢复。
- SSR 利用程度高：所有公开页面首屏 HTML 即含完整数据（含 base64 LQIP），anon 可 CDN 缓存——这是本项目最不希望丢掉的架构资产。

---

## 3. 组件清单

**没有任何组件超过 300 行**（最大的页面 `posts/[id].vue` 317 行、组件 `TagsPanel` 285 行）。巨型度整体健康。

### 3.1 根级 `components/`（14 个，公开站核心）

| 组件 | 行数 | 职责 |
|---|---|---|
| `PhotoGrid.vue` | 32 | 纯 CSS `columns-2..7` 瀑布流容器；把当前页 post id 列表 JSON 化进 `listParam` 传给详情页做 J/K 导航 |
| `PhotoCard.vue` | 109 | 卡片：LQIP blur → 真图淡入 / skeleton 兜底、rating 角标（admin）、hover 标签遮罩、移动端底栏；单击开 `ImageModal` |
| `ImageModal.vue` | 182 | 手写 pan/zoom/dblclick/pinch/wheel-anchored 缩放查看器 |
| `SearchBar.vue` | 218 | 搜索框 + 自动补全（250ms debounce + AbortController 竞态控制 + 键盘导航 + ARIA combobox） |
| `Pagination.vue` | 123 | 页码省略算法 + 每页条数选择（20/40/100，写 cookie）；SSR/客户端双路径 URL 构造 |
| `PostInfoPanel.vue` | 105 | 详情页信息卡（来源/尺寸/大小/格式/时间 + 原图/删除/评级编辑），纯展示 + emit |
| `PostSeriesNav.vue` | 125 | 多图系列缩略图条、数字键 1-9 跳页、admin 删除单页后 `window.location.reload()` |
| `TagBadge.vue` | 44 | 标签徽章（左侧色条、hover 显翻译） |
| `SearchBar` 配套 `Kbd.vue` / `KbdCheatSheet.vue` | 42 / 84 | 键帽渲染（平台感知 ⌘/Ctrl）、快捷键总表弹窗 |
| `AccentPicker.vue` | 71 | 色相滑块（0-360°），写 cookie + localStorage + CustomEvent 三处 |
| `ThemeToggle.vue` | 64 | auto/light/dark 三态循环，localStorage 持久化 |
| `AnnouncementBanner.vue` | 158 | 公告：多行轮播 + 超长水平滚动 + 手写 mini-markdown 渲染（`v-html`，先转义防 XSS） |
| `BottomTabBar.vue` | 101 | 移动端底部 tab（画廊/搜索/随机 + 菜单） |

### 3.2 `components/admin/`（10 个）

| 组件 | 行数 | 职责 |
|---|---|---|
| `TagsPanel.vue` | 285 | **最大组件**：标签管理表格（筛选/排序/行内编辑/合并对话框/AI 重处理/画师分类修复） |
| `PostsPanel.vue` | 227 | 图片管理：桌面表格 + 移动卡片双视图、行内改评级、删除 |
| `DashboardPanel.vue` | 215 | 概览卡 + 手写 SVG donut（来源分布）+ 分段条（评级分布）+ 热门标签 |
| `SettingsPanel.vue` | 164 | 站点设置 + DB/Redis 连接测试 |
| `ExtensionKeysPanel.vue` | 154 | 扩展 API Key 生成/吊销/一次性明文展示 |
| `AutoRatingPanel.vue` | 142 | 自动评级规则 CRUD + 标签补全 |
| `AiAssistantPanel.vue` | 87 | AI 助手壳：4 个子 section tab（URL 持久化）+ KeepAlive |
| `AdminStatusBar.vue` | 61 | 队列深度轮询（5s，页面不可见时暂停）+ AI 状态 |
| `PasswordPanel.vue` | 58 | 改密码 |
| `TagIdTooltip.vue` | 35 | 点按复制 tag UUID |

### 3.3 `components/admin/ai/`（5 个）

| 组件 | 行数 | 职责 |
|---|---|---|
| `AiClassifyPanel.vue` | 143 | AI 标签分类：job 轮询（1s）→ 建议表格 → 逐条应用 |
| `AiRatingsPanel.vue` | 131 | AI 评级建议：同上，轮询 1.5s |
| `AiMergesPanel.vue` | 125 | AI 合并建议：扫描 → 执行合并（先 fetchAdminTags 查 id 再 merge） |
| `AiChatPanel.vue` | 114 | AI 对话：历史存 localStorage（cap 50 条）、suggestion 按钮回填发送 |
| `AiStatusBar.vue` | 21 | AI 状态点 + 模型名（模板里内联 IIFE 解析 URL hostname） |

### 3.4 `components/ui/`（5 个通用件）

`PageHeader` 18 / `EmptyState` 22 / `LoadingCard` 19 / `ConfirmDialog` 59（Teleport + Enter/Esc 全局键）/ `ToastContainer` 64（Teleport + TransitionGroup）。

---

## 4. 样式体系

**混合体系：Tailwind v4 + 一层手写 CSS 设计系统**，且手写层是"主"，Tailwind 是"辅"。

### 4.1 组织方式

- 唯一入口 `assets/css/main.css`（733 行），`@import "tailwindcss"` 开头。
- Tailwind v4 `@theme {}` 块定义基础色板（**全部 oklch**）：accent、light/dark 两套 surface、status、5 个标签分类色（main.css:28-108）。
- 运行时主题通过 `:root` / `.dark` 下的 **CSS 自定义属性别名层**实现（main.css:114-152）：`--bg-primary/--text-muted/--accent-color...` 指向 @theme 常量；accent 色用 `--accent-hue`（175 默认）运行时插值，支持 AccentPicker 任意改色相。
- 然后是 ~480 行手写组件类：`.card/.dash-card/.nav-glass/.filter-pill/.page-btn/.page-num/.masonry-item/.btn-primary/.btn-ghost/.btn-danger/.skeleton/.lqip-blur/.img-real` + **21 个 @keyframes**。

### 4.2 设计 token 收敛度：高

颜色（oklch）、圆角（8 档）、阴影（5 档）、动效（2 条 easing + 5 档时长）、字号（5 档含 clamp 流式 display 字号）、字体（display/body/mono 三栈）全部 token 化，组件内极少裸 hex。这是"有设计系统"的，而且设计语言自洽（见 §7）。

### 4.3 但有明显的体系摩擦

1. **`var()` 任意值泛滥**：模板里大量 `text-[var(--text-muted)]`、`border-[var(--border-color)]`、`rounded-[var(--radius-sm)]`——Tailwind 被当 flex/grid/间距工具用，颜色语义全靠手写变量。结果是两套语法在每行 class 里交织，模板可读性下降，且 Tailwind 的 token 编译优化（@theme 直出 utility）没被用上。
2. **内联 style 与 class 混用**：`style="font-family: var(--font-display)"`、`:style="{ background: ... }"` 遍布各组件；DashboardPanel 甚至用 `@mouseenter/@mouseleave` 直接改 `el.style.borderColor`（DashboardPanel.vue:168-169）做 hover，绕开 CSS。
3. **`!` 强制覆盖成惯例**：`btn-primary !text-xs !px-2.5 !py-1.5` 出现 20+ 次——说明 `.btn-primary` 只有一个尺寸变体，没有真正的尺寸系统。
4. **暗色残留硬编码**：`.tag-artist` 等类里写死亮色 hex 背景（`#fef3c7` 等，main.css:264-268），暗色模式下不切换（实际上这些类已被 `getTagCategoryVar` 路线取代，见 §8 死代码）。
5. **字体是空头支票**：`@font-face KuraDisplay` 指向 `/fonts/display-*.woff2`，但 `public/fonts/` 只有 README——字体文件不存在，全靠注释声明"404 无影响"（main.css:11-21）。display 字体实际始终回落系统栈。
6. **全局噪声纹理**：`body::before` 固定定位 SVG feTurbulence 噪点（main.css:180-197），有品位但在低端机上是持续的合成层开销。

**CSS 总量**：main.css 733 行 + 组件 `<style scoped>` 约 250 行 ≈ 1000 行手写 CSS，加上 Tailwind utilities。量级小、可控。

---

## 5. 状态与数据流

### 5.1 composables（9 个）

| 文件 | 行数 | 职责 |
|---|---|---|
| `composables/api.ts` | 353 | **API 层核心**：`fetchApi` 封装（SSR 走 `internalApiUrl` 内网地址、客户端走 `/api`；SSR 手动透传 cookie；204 处理；ApiError）+ ~30 个端点函数 |
| `composables/ai.ts` | 82 | AI 域 API，**刻意绕开 api.ts 用裸 `$fetch`**（注释：fetchApi auto-import 在 code-split chunk 里解析失效，ai.ts:3-4）——两套请求封装并存 |
| `composables/utils.ts` | 102 | 纯函数工具：per-page clamp、图片 URL 拼接（`/i/<key>`）、评级/分类/来源 label 与颜色映射 |
| `composables/useSsrContext.ts` | 9 | **全局状态实质所在**：`useState` 三个键 `isAdmin/ssrCookie/siteSettings`，由 layout 在 SSR 时填充 |
| `composables/useKeyboardShortcuts.ts` | 96 | 全局快捷键（`/`、`?`、`G+T`、`J/K`、`←/→`），调用方注入回调 |
| `composables/useToast.ts` | 38 | **模块级 `ref` 单例**（非 useState）——跨组件共享，但 SSR 下模块单例有跨请求泄漏的理论风险（当前仅客户端调用故无恙） |
| `composables/useConfirm.ts` | 40 | 同上，Promise 化确认框单例 |
| `composables/usePlatform.ts` | 38 | ⌘/Ctrl 平台检测，cookie + 内联脚本 anti-flash |
| `composables/useAccent.ts` | 9 | accent 色相常量（默认 175，跨度 25°） |

### 5.2 全局状态管理

**无 Pinia**。全局态 = `useState` × 3 + 模块级 ref 单例 × 2 + cookie/localStorage/sessionStorage 散落 8 处（theme、accent-hue、per-page、platform、recent-searches、ai-chat-history、announcement-dismissed、scroll 位置）。对当前规模够用，但"状态真相源"分散在 5 种机制里。

### 5.3 Props drilling

- 最严重：`pages/posts/[id].vue` → `PostInfoPanel`，**7 个 props + 3 个事件**，且桌面/移动各渲染一份（posts/[id].vue:280-310）。
- `ssrCookie` 从 `useSsrContext` 取出后逐层传给 AI 子面板（AiAssistantPanel → 4 个 ai/*.vue 各收 `:ssr-cookie` prop）。
- 其余基本是单层（page → grid → card），健康。

### 5.4 前端调用的 API 端点（对照 server/routes/api）

前端实际调用：posts（list/get/random/patch/delete/tags.put）、tags（list/get/autocomplete）、search、auth（login/change-password）、settings（public/admin get/put、test-pg/test-redis）、auto-rating-rules（get/post/delete）、admin/tags（get/patch/merge/reprocess/fix-artist-categories）、admin/dashboard（stats + system-status）、admin/extension-keys（get/post/delete）、admin/ai/*（status/classify-tags/suggest-merges/suggest-ratings/jobs/chat）、tasks/web-import（+ SSE stream）。

**前端未用**：`posts/by-source`、`tasks/index.post`、`tasks/[id].get`、`admin/tags/aliases/*`、`rebuild/index.post`、`settings/index.get|put`（用的是 admin/settings）。api.ts 中 `fetchAuthStatus`/`logout`/`removeTagFromPost`/`fetchTagKnowledge`/`webImport` 也无调用方（logout 走原生 `<form action="/logout">`；import 页内联了 $fetch）。

---

## 6. 性能观察

### 6.1 做得好的

- **真 LQIP**：服务端 sharp 生成的 base64 缩略图内联在 SSR HTML 里（PhotoCard.vue:44-51），非假的灰色块；无 LQIP 时 skeleton shimmer 兜底。
- **布局零抖动**：卡片 `aspectRatio: width/height` 占位（PhotoCard.vue:43），详情页同样（posts/[id].vue:242）。
- **懒加载**：网格 `loading="lazy" decoding="async"`；详情页主图 `loading="eager" fetchpriority="high"`——优先级策略正确。
- **无 JS masonry**：纯 CSS `columns-*`（PhotoGrid.vue:21），零布局计算成本。
- **分包克制**：admin 8 面板全部 `defineAsyncComponent`（admin/index.vue:29-36），匿名用户 bundle 不含任何 admin/AI 代码。
- **bundle 极干净**：没有任何大库可"全量引入"——最大的客户端依赖就是 Vue/Nuxt 本体。这是"手写一切"策略的副产品红利。
- **轮询有节制**：AdminStatusBar 5s 且 `document.visibilityState` 门控；AI job 1s/1.5s，unmount 即停；SSE unmount 关闭。

### 6.2 短板

1. **无响应式图片**：preview 只出一张图，没有 `srcset/sizes`——2x 屏手机和桌面拿同一张。也没用 `@nuxt/image`。
2. **每个卡片常驻一个 ImageModal 实例**：PhotoCard.vue:108 每张卡挂一个 modal 组件，其 `onMounted` 无条件注册 document keydown（ImageModal.vue:126-128）——一页 40 张卡 = 40 个全局键盘监听（虽各自 cheap）。应改为单例 modal 由 grid 层托管。
3. **列表-详情导航数据靠 URL 传**：`listParam = encodeURIComponent(JSON.stringify(ids))`（PhotoGrid.vue:15-17）把整页 id 塞进 query，详情页再 parse（posts/[id].vue:125-130）。40 个 UUID ≈ 1.6KB URL——可用但丑，是"无 store"架构的绕路。
4. **分页制，无无限滚动**：这是与典型 booru 的明确取舍（见 §7），性能上是优点（无无限列表内存膨胀），体验上是差异点。
5. **无虚拟滚动**：admin 表格一次 50/100 行原生 DOM，当前规模无碍。
6. **首屏串行动画**：卡片 `blurReveal` + 前 12 张 60ms 阶梯 delay（PhotoCard.vue:38-39），好看但每页加载都重放，且与 `loading=lazy` 的图片加载节奏无协调。
7. **SSR HTML 体积**：40 张卡 × base64 LQIP（每条约几百字节-1KB）+ 完整标签数组内联，首页 HTML 偏大；换来的是零闪烁，权衡合理但值得量化。

---

## 7. 交互 / 设计观察

### 7.1 视觉语言

- **配色**：oklch 双色相渐变 accent（默认 175°→200°，青绿系，用户可全色相自定义）+ 微暖纸白（light）/ 微暖墨色（dark）底；tag 五分类色；rating 三态色。克制、现代、不"二次元"。
- **排版**：display 字号 clamp(1.75-3rem) + 渐变文字标题 + `maskWipe` 入场；正文 0.9375rem；meta 信息 0.8125/0.6875rem 密集小字 + tabular-nums 数字。
- **密度**：高。导航 56px、公告 32px、卡片 gap 0.5rem、booru 式紧凑瀑布流。
- **动效**：体系化（21 个 keyframes、5 档时长、spring easing），全站入场/卡片 stagger/模糊揭示；有 `prefers-reduced-motion` 全局降级（main.css:726-733）。噪点纹理 + 玻璃拟态导航是标志性处理。
- **细节完成度罕见**：双 anti-flash（主题 + accent + 平台）、滚动位置记忆、`?` 快捷键总表、ARIA combobox、安全区 inset、触屏 pinch、error.vue 也走 layout 保证主题不闪（error.vue:4-7 的注释说明这是修过的坑）。

### 7.2 与典型 booru 的异同

| 维度 | danbooru/safebooru/gelbooru | kura-booru-next |
|---|---|---|
| 信息架构 | 帖子列表 + 左侧标签栏常驻 | 同款（详情页三栏），但列表页**无侧栏** |
| 导航 | 分页 | 分页（刻意不用无限滚动） |
| 搜索语法 | `tag1 tag2 -tag3` | 同款（`+` 组合 `-` 排除 `source:` 前缀） |
| 标签分类色 | artist/char/copy/general/meta 五色 | **完全同款五色**（danbooru 传统） |
| 评级 | s/q/e | 同款（公开/敏感/限制） |
| 标签浏览 | 表格/列表 | **字号缩放的标签星座图**（差异点，更现代但牺牲了扫读效率） |
| 详情页弹层 | 无或弱 | 单击即开 zoom modal（强于传统 booru） |
| 键盘流 | danbooru 有快捷键 | 同款甚至更全（J/K、G+T、`/`、`?`） |
| 视觉 | 功能主义、广告位 | 杂志化、品牌化、无广告 |
| 元信息 | wiki/notes/pools/artist 条目 | 只有 translation + danbooru_name，无 wiki/pools |

### 7.3 明显体验短板

1. **无收藏/评分/评论/黑名单**——个人站定位可解释，但 booru 核心留存机制缺失。
2. **tag 星座图华而不实**：`/tags` 页按字号缩放 + hover 才显示翻译，找标签比 danbooru 的表格更慢；无页内过滤输入框。
3. **移动端详情页标签挤成 pills**（posts/[id].vue:257-276），与桌面分组侧栏信息层级不一致。
4. **搜索无负反馈恢复**：未解析标签只提示文字（search.vue:122-127），不给"你是不是要找"建议。
5. **公告/弹窗 z-index 手工管理**：`z-30/z-40/z-50/z-[100]/z-[101]/z-[120]` 散布各处，无层级 token。
6. **ImageModal 无手势关窗**（下滑关闭）、无左右切图——移动端看图链路断在"回详情再回列表"。

---

## 8. 代码质量痛点（换栈难度评估）

### 8.1 死代码 / 重复代码（证据确凿）

- **api.ts 5 个无调用方函数**：`fetchAuthStatus`（api.ts:136）、`logout`（:148）、`removeTagFromPost`（:238）、`fetchTagKnowledge`（:275）、`webImport`（:347）。
- **utils.ts 双套分类色**：`getTagCategoryColor`（:63，返回旧 class 名）与 `getTagCategoryBg`（:77，硬编码亮色 hex）均无调用方；现役是 `getTagCategoryVar`（:88）。对应 main.css:264-268 的 `.tag-*` 类同样是死样式。
- **两套请求封装**：api.ts 的 `fetchApi` vs ai.ts 的 `aiFetch`（ai.ts:3-4 注释承认是 auto-import 在异步 chunk 失效的 workaround）；import.vue 还内联了第三处 `$fetch`（admin/import.vue:23）。
- **两套"分类选项"常量**：TagsPanel.vue:129-144 与 AiMergesPanel.vue:87-94 各抄一份；评级选项在 index.vue/posts/[id].vue/PostsPanel/AutoRatingPanel 出现 4 次。
- **AI 轮询逻辑三份复制**：AiClassifyPanel/AiMergesPanel/AiRatingsPanel 的 `pollJob/stopPolling/runX` 结构雷同（各 ~40 行），应抽 composable。
- **评级徽章渲染**在 PhotoCard 出现两次（桌面角标 + 移动底栏，PhotoCard.vue:68-75 与 :97-102）。

### 8.2 魔法数与散落约定

- 8 个 storage key 字符串散落（`kura-theme-preference`/`kura-accent-hue`/`kura-per-page`/`kura-platform`/`kura-recent-searches`/`kura-ai-chat-history`/`kura-announcement-dismissed`/`kura-scroll:`），无集中常量。
- `175`（默认色相）在 main.css/useAccent/AccentPicker 三处；per_page `{20,40,100}` 在 utils.ts 与 Pagination.vue:12 各一份。
- z-index 裸值（见 §7.3）；`0.625rem/0.6875rem/0.5625rem` 微字号裸写 30+ 处。
- 防抖/轮询时长裸写（250ms/5s/1s/1.5s/150ms）。

### 8.3 耦合点（换栈时最难搬的部分，按难度排序）

1. **SSR cookie 透传链**（耦合 Nuxt runtime）：`useRequestEvent().context`（由 server middleware 注入 isAdmin/ssrCookie/siteSettings）→ `useSsrContext` → 每个 `fetchApi(ssrCookie)`。这条链同时绑定 Nuxt 的 `useState/useAsyncData` 缓存语义和 anon-HTML-CDN 缓存策略（nuxt.config.ts:42-58 的 swr 事故注释证明它脆弱且已被踩过）。**换框架 = 重设计这条链**。
2. **anti-flash 三件套**：layout 内联脚本（theme）、usePlatform 内联脚本、htmlAttrs 上 SSR 渲染的 `--accent-hue` style。任何 SPA 化方案都会丢掉"首帧无闪烁"，需要等量替代。
3. **auto-import 依赖**：全项目依赖 Nuxt composable 自动注册（api.ts/utils.ts 无 import 直接用），ai.ts:3-4 的 workaround 注释证明这套机制已在 code-split 边界漏过一次。脱离 Nuxt 时所有文件要补 import，且这个隐性 bug 模式要系统性复查。
4. **`useAsyncData` + watch(query) 的列表页范式**：8 个页面共用，换成 SPA 数据获取（SWR/TanStack Query 或手写）是机械工作但量大；换成别的 SSR 框架则要重建 hydration 缓存键语义（动态 key 字符串拼接，如 `posts-${page}-${perPage}-${rating}`）。
5. **键盘快捷键的调用方注入模式**：`useKeyboardShortcuts({ onPrevPost... })` 被 layout + 4 个页面各自实例化（意味着同页面可能挂 2 个 document 监听，layout 一个 page 一个），语义靠注释维护（posts/[id].vue:141-142）。迁移时容易漏。
6. **CSS 变量别名层**：`--accent-hue` 运行时插值 + `.dark` 类切换 + Tailwind arbitrary-value 语法三者纠缠——这套样式搬到任何非 Tailwind 方案都要重新决定"token 归谁管"。
7. **相对低耦合、好搬的**：ImageModal/SearchBar/PhotoCard 等纯组件（只依赖 Vue 语义和 types/index.ts 的 150 行类型）；`composables/api.ts` 本质是 fetch 封装，框架无关。

### 8.4 其他

- `pages/admin/import.vue` 是个"页面"但视觉上按面板写（无 PageHeader），从 PostsPanel 跳转——路由结构遗留。
- `TagsPanel` 的 `page` 在 setup 顶层从 route.query 读一次（TagsPanel.vue:6），不响应变化（且自身无分页 UI——实际只能看前 50 条）。
- `PostSeriesNav` 删除后 `window.location.reload()`（PostSeriesNav.vue:61）——粗暴但注释解释了理由。
- `login.vue` 成功后整页刷新、logout 用原生 form POST——SPA/MPA 边界靠硬刷新维持状态正确性，是当前架构的诚实选择，也是 SPA 化时要补的状态同步点。

---

## 9. 总结判断（供选型讨论）

**这套前端的最大资产**：零重依赖的 bundle、完整自洽的 oklch token 设计系统、高完成度的 SSR + CDN 缓存链路、系统化的动效与 anti-flash 细节、组件粒度健康（无 500+ 行怪兽）。

**最大负债**：样式层"Tailwind + 手写变量 + 内联 style"三轨并行、Nuxt auto-import/SSR-context 的深度魔法耦合、约 400 行可立即删除的死代码与重复段。

**对 v0.9.0 选型的含义**：

- 若走方案 A（保留 Nuxt）：前端工作主要是"收敛"而非"重写"——删死代码、统一请求层、抽 AI 轮询 composable、token 归一（z-index/字号/storage key）、样式二选一（Tailwind 语义化 or 纯手写），预估是低风险高收益。
- 若走方案 B（前端分离/换框架）：纯组件层（~70% 代码）可平移；真正的重写成本集中在 §8.3 的 1-4 条（SSR 数据链 + anti-flash + auto-import 清理 + 列表页数据范式），且 SSR + anon CDN 缓存是 danbooru 类站点最有价值的性能特性，SPA 化需要非常强的理由。
