# v0.9.0 行动计划：功能复刻 + 档案馆化前端 + 同栈分层重构

> 状态：**定稿**。基准版本：v0.8.1（git tag `v0.8.1`）。
> 本版由草案修订而来，修订依据是两份全量代码审计（每条结论带文件:行号证据）：
> - `docs/frontend-audit-v0.9.0.md`（前端 59 文件 / 6,769 行 + main.css 733 行）
> - `docs/backend-audit-v0.9.0.md`（server 97 文件 / 6,083 行 + 8 插件 + sidecar 接口）

## 目标定义

v0.9.0 = **以 v0.8.1 功能为基准的全量重构**，三条主线：

1. **功能复刻**（feature parity）：52 个路由文件 / 53 端点、10 页面前端、sidecar / bot / extension / AI 四域全部行为不变。
2. **前端档案馆化**：画廊从"杂志风"演进为"档案馆风为底 + 较小图片间距 + 响应式列数"（已拍板，见 §前端）。
3. **后端分层重架构**：同栈（Nuxt 4 / Nitro 保留），消灭 utils 大杂烩，队列统一为显式 job 模型，契约显式化。

## 关键审计结论（决策前提）

- **前端是资产不是负债**：oklch token 全收敛、真 LQIP、SSR + anon CDN 缓存链路、零前端第三方库、无 >300 行组件。换框架（SvelteKit 等）**已否决**：SSR cookie 透传链、anti-flash 三件套、auto-import 依赖、`useAsyncData+watch(query)` 列表范式 ×8 页是换栈最难搬的四件套，且 SSR + anon CDN 缓存是本站最有价值的性能特性。
- **后端 80% 痛点是组织问题不是框架问题**：routes 层已经很薄（~45/52 只做"鉴权→校验→调 utils"），病灶在 utils 层——3,540 行中 72% 集中在 ai.ts(735) / bot.ts(676) / pipeline.ts(609) / queries.ts 四文件，交叉调用无领域边界。
- **方案 B（Hono 换栈）否决并存档**：前端留 Nuxt 做 SSR → Nitro 必须存在 → 换 Hono 等于多养一个服务，撞"容器数不增"硬约束；Python sidecar 消费不了 pg-boss/BullMQ（Node-only）必须留 Redis 桥；Redis 有 8 类非队列用途（会话纪元、登录锁定、限流、bot 状态、AI job、审计、RediSearch、缓存），"容器 4→3"不成立。方案 B 降级为"前端未来若脱离 Nuxt 时再议"的存档项。
- **pg-boss 与换栈是两个独立决策**：pg-boss 可以在 Nitro 插件里初始化，不换框架也能统一 job 模型。

## 硬约束（任何方案都必须满足）

1. **数据兼容**：现有 Postgres 10 表 + S3 对象 + Redis 队列语义原地兼容。posts 系列三列 NULL 语义、物化视图 mv_dashboard_stats、trgm 索引保留。
2. **phash 跨栈位一致**：600+ 条 phash 由 Python `imagehash` DCT 生成，去重链路依赖它 —— **Python sidecar 保留**（gallery-dl 双重绑定）。
3. **外部契约不变**：浏览器扩展（2 端点 + `kb_ext_` key + `in_progress` 等状态字面量 + phash 剥离）、Telegram webhook（secret_token + callback_data 协议）、OpenAI 兼容 AI 出向调用 —— 扩展 35 个测试为回归基准。
4. **部署形态不变**：单机 docker-compose，容器数不显著增加（现 4 个：web/worker/postgres/redis）。

## 技术选型决策汇总

| 项 | 决策 | 状态 |
|---|---|---|
| 前端框架 | Nuxt 4 + Vue 3 + Tailwind v4 保留；SvelteKit/SPA 化否决 | ✅ 已定 |
| 画廊风格 | 档案馆风为底 + 较小图片间距（非零 gutter 折中）+ 响应式列数 | ✅ 已定 |
| 后端框架 | Nitro 保留，方案 A 分层重架构；Hono 存档 | ✅ 已定 |
| 队列 | 统一 job 模型（接口先行）；pg-boss spike 后 ADR 定是否替换 Redis 队列 | 🔶 spike |
| 搜索 | RediSearch 三选一（改名小修 / 删了用 PG trgm / 真接 Meili）→ ADR | 🔶 ADR |
| 缩略图 | imgproxy spike（须配防 CVE-2025-24354）vs sharp 内嵌 → ADR；与前端 srcset 联动 | 🔶 spike |
| sidecar | 原样保留（Python + gallery-dl + imagehash），队列桥不变 | ✅ 已定 |
| bot | grammy 逻辑保留在 Nitro 内，模块化拆分 | ✅ 已定 |

---

## 前端行动方案

### F1 收敛清单（复刻的一部分，均有审计行号证据）

- **删死代码 ~400 行**：api.ts 5 个无调用方函数（fetchAuthStatus/logout/removeTagFromPost/fetchTagKnowledge/webImport）；utils.ts 的 getTagCategoryColor/getTagCategoryBg；main.css:264-268 的 `.tag-*` 死样式。
- **统一请求层**：ai.ts 裸 `$fetch`（ai.ts:3-4 注释：auto-import 在 code-split chunk 失效）并入 api.ts 封装，消灭两套并存；api.ts 后续由 openapi-typescript 生成类型取代手写（见 F4）。
- **抽 `useAiJobPolling` composable**：admin/ai 三处轮询各 ~40 行雷同逻辑合一（保留 visibility 门控）。
- **样式 token 归一**：消灭 `text-[var(--text-muted)]` 式 arbitrary-value 泛滥与 `btn-primary !text-xs` 强制覆盖 20+ 处；DashboardPanel.vue:168-169 的 mouseenter 直改 el.style 改为 CSS hover。
- **ImageModal 单例化**：现每卡片常驻一个实例（40 卡 = 40 个 document keydown 监听，ImageModal.vue:126-128），改为 teleport 单例 + 当前 post 注入。
- **修 `@font-face` 死链**（public/fonts 只有 README）：补字体文件或删声明。
- **z-index 归一**：z-30 到 z-[120] 裸值散落，收敛成 token 层（nav / modal / toast 三级）。
- **重复常量合并**：分类选项 ×2、评级选项 ×4、评级徽章 ×2。

### F2 档案馆化改造（已定方向：档案馆为底 + 小间距 + 响应式）

- **PhotoGrid 双视图**：新增"档案馆密度模式"为默认画廊视图，杂志卡片视图保留为切换项（视图偏好存 localStorage，SSR 端 anti-flash 读取，沿用现有主题 anti-flash 链路）。
- **网格规格**：
  - 间距：小 gutter（4–8px token 化，非零间距），图片圆角取消或 ≤2px；
  - 响应式列数：≈6 列 @700px / 8 @900 / 10 @1400 / 12 @1700（CSS 实现用 column-width 或 grid + container query，以现有 CSS columns 瀑布流改造成本最低为准）；
  - 缩略图尺寸切换：header 文字链 3 档（约 50 / 120 / 240px 列宽），就地切换 + 网格平滑重排（CSS transition on column-width 或 FLIP）。
- **信息出现方式**：档案馆模式下缩略图无常驻文字，悬停浮层显 `编号 · 标签数 · 评级`（渐隐 0.5s）；用 `@media (hover:hover) and (pointer:fine)` 门控 hover 态（顺带解决移动端黏滞 hover）。
- **blur-up 升级**：现有 LQIP（sharp base64 内联 SSR）从"占位"升级为 5px→0 渐进清晰过渡（0.5s opacity + blur），reduced-motion 下直出。
- **UI 无色化**：档案馆模式下 chrome 单色化——弱化渐变标题与彩色徽章，颜色由图片供给；五色标签分类系统保留（信息功能非装饰）。
- **移动端补强**：modal 手势关窗 + 左右切图（ImageModal 单例化后一并做）。
- **标签页双视图**：标签星座图加"列表 / 星座"切换（星座图扫读慢是审计确认短板，列表视图成本极低）。

### F3 图片管线（与后端 ADR 联动）

- **srcset/sizes**：审计确认前端无响应式图片是明确短板。若 imgproxy ADR 通过则 srcset 近乎免费（100w–2000w 多档）；若维持 sharp，则构建期/导入期预生成 2–3 档。决定前先做 imgproxy spike（B4）。
- **URL 传参瘦身**：整页 post id 经 URL JSON 传详情页（~1.6KB query）改为 id 列表存 sessionStorage + 详情页回源单条。

### F4 契约下游收益

- 53 端点 OpenAPI 契约冻结后（B5），用 openapi-typescript 生成前端类型，api.ts 的 ~30 个手写端点函数改为类型安全的薄封装。

---

## 后端行动方案

### B1 分层重架构（方案 A 主体）

目标结构：

```
server/
  routes/          # 薄路由保持薄：鉴权 → zod 校验 → 调 module
  modules/
    posts/         # service + repo（吸收 queries.ts 读写两侧）
    tags/
    search/
    import/        # pipeline 域
    ai/
    auth/
    admin/
    bot/
  platform/        # queue / redis / s3 / config / errors / handler 包装
```

拆分顺序按审计实测难度（易→难），每步独立可验证：

1. **ai.ts（735 行，最易）**：8 个职责块经 `callAi` 收敛、互不调用，机械拆分。
2. **queries.ts**：读查询已是事实上的 read repo，补写路径收口（手写 SQL 现散落 18 个文件）。
3. **pipeline.ts（609 行）**：单图/多图两路径间 5 个步骤块逐行重复 ~150-180 行，先去重再拆；多图路径的 series 并发处理（23505 恢复、series_id 预生成）是全项目最精细的并发代码，拆分时**保留全部决策注释**。
4. **bot.ts（676 行，最难）**：扇出最大（依赖 5 个 utils）；`!` 别名与斜杠命令逐句重复 ~80 行、两个消息 handler 再重 ~30 行、i18n 表与 bot-rating.ts 双份维护——先合并 i18n 与命令表再拆。

### B2 横切层（handler 包装 + zod + 错误形状）

- **handler 包装**：`getIsAdmin` 48 次调用中 ~40 次是逐字三行样板；apikey 限流块两文件逐字重复 → 一个 `defineAdminHandler` / `defineExtHandler` 包装消灭。
- **zod 校验**：现零 zod、枚举硬编码重复 4 处 → 53 端点全量入参出参 schema，枚举单点定义。
- **统一错误形状**：103 处 createError 无统一格式 → `{ code, message, details? }` 约定 + 包装层兜底。
- **中央 config**：runtimeConfig 形同虚设 → `platform/config.ts` 单点读取 + 启动校验。

### B3 队列与异步统一

现状是跨两语言三进程的 4-key 状态机：`kura:jobs`（web LPUSH → sidecar BRPOP）→ `kura:results:` + `kura:pending_results` → 覆盖写 + `kura:job_status:` done → 三路消费（bot 500ms 轮询、SSE 2s 轮询、tasks/[id] 状态翻译）。

- **JobQueue 接口先行**：`enqueue / getStatus / consume / retry`，默认实现仍 Redis（行为不变）。
- **补功能缺口**（审计发现）：`handleJobWithRetry`（queue.ts:106-113，MAX_RETRIES=3）是零调用死代码——实际**无重试无 DLQ**，pipeline 失败只能等 300s 轮询超时；统一 job 模型时把重试 + DLQ 做实。
- **AI job 持久化**：现靠 `event.waitUntil` 续命，进程重启即丢 → 并入统一 job 模型（Redis `kura:ai_job:{id}` 语义保留，进度回调改走 job 状态）。
- **8 个 Nitro 插件收编**：2 setInterval + 1 无限 BRPOP + 4 启动钩子 + 1 close 钩子的杂牌军 → 统一为 `platform/jobs.ts` 注册的命名任务（pipeline-worker / dashboard-refresh-5min / sync-tasks-1h / redis-index-sync 等）。
- **SSE 统一**：AI job 进度从轮询切到 SSE（tasks 已有 SSE stream 先例），bot/extension 轮询协议**不动**（外部契约）。

### B4 pg-boss spike（独立 ADR，不阻塞 B3）

- spike 范围：pg-boss 最小 demo 跑通——Nitro 插件内初始化、Node 侧 job（AI job + dashboard 刷新 + 定时 reconcile）收编、SKIP LOCKED 消费验证。
- **明确边界**：Python sidecar 消费不了 pg-boss，`kura:jobs` → sidecar 的桥保持 Redis 不动；结果回取协议（TTL 语义 + `in_progress` 状态字面量）有 bot/extension/SSE 三方外部消费，迁移需契约测试护住。
- ADR 决策点：pg-boss 全收编 vs 仅收编 Node 侧 vs 维持 Redis（接口已抽象则切换成本已付过）。

### B5 契约显式化

- 53 端点补 zod → hono 不需要，Nitro 下用 zod + 手写/生成 OpenAPI 文档（评估 zod-to-openapi 轻量生成）。
- **标注不可变契约**：扩展 2 端点（web-import.post.ts + tasks/[id].get.ts）、bot webhook、`/i/` 反代（43 行，Range 透传 + 流式）。
- 产出 OpenAPI JSON → 前端 openapi-typescript（F4）。

### B6 数据层修正

- **phash 表达式索引**（审计发现的真实失效）：`ix_posts_phash` 是普通 btree，pipeline 用 `left(phash,4)` 前缀桶查询（pipeline.ts:69）走不到 → 加 `CREATE INDEX ... (left(phash,4))`，EXPLAIN 验证。
- 写路径 SQL 收口进 modules repo（18 个文件散落 → 各域 repo）。
- schema 原地复用（Drizzle schema 平移，无 dump/restore）；物化视图与 trgm×4 不动。

### B7 RediSearch 处置（三选一 ADR）

审计确认三重名不副实：① 实为 RediSearch 非 Meili；② 只管 `/api/tags/autocomplete`，主搜索 searchPosts 是纯 SQL EXISTS 完全不碰它；③ 索引新鲜度半失守（写穿透只挂 admin tag PATCH，`deleteTagIndex` 零调用）。

- 选项 a：改名 `REDISEARCH_ENABLED` + 补索引同步（小修）
- 选项 b：删掉，autocomplete 走 PG trgm（当前数据量够用，少一类 Redis 用途）——**倾向项**
- 选项 c：真接 Meilisearch（超 feature parity，另立版本）

---

## 执行阶段

### 阶段 0：spike 与 ADR（约 2–3 天）

- spike 1：pg-boss 最小 demo（B4 范围）
- spike 2：imgproxy docker 跑通 + 防 SSRF 配置（`IMGPROXY_ALLOW_LOOPBACK_SOURCE_ADDRESSES=false` 等）+ 与现有 S3/反代链路验证
- 写 4 条 ADR 落 `docs/adr/`：队列选型、搜索索引选型、缩略图方案、错误/契约约定
- 产出：ADR 目录 + 本文件 §技术选型决策汇总 状态更新

### 阶段 1：骨架与契约冻结（约 3–4 天）

- `server/modules/` + `server/platform/` 目录骨架 + handler 包装 + zod 骨架 + 统一错误形状（B2 先行，后续所有迁移直接用新范式）
- 53 端点契约冻结（标注 3 类不可变契约）+ API 契约测试基线
- 前端：`server/api.ts` 请求层统一 + `useAiJobPolling` + 死代码清除（F1 中无依赖项先做）
- CI：typecheck + 扩展 35 测试 + 契约测试

### 阶段 2：核心域迁移（按依赖序，每步独立可验证）

1. **数据层修正**：phash 表达式索引 + 写路径收口（B6）→ 只读链路先稳
2. **posts/tags/search 模块**：queries.ts 拆分 + 只读端点迁移 → 前台只读页面可用
3. **auth 模块**：三种 auth 方式收编进 handler 包装（cookie session / BACKEND_API_KEY / extension keys）
4. **import 链路**：pipeline.ts 去重拆分 + 队列接口化（B3）→ enqueue → sidecar → pipeline → S3 → DB 全链路在新结构下跑通
5. **admin 全量**：8 panel + dashboard MV + AI 域（ai.ts 拆分 + job 持久化 + SSE 进度）
6. **前端档案馆化**（与 2–5 并行，从只读页面切入）：PhotoGrid 双视图 + 网格规格 + 悬停浮层 + blur-up + 尺寸切换 → 移动端手势 → 标签双视图
7. **bot + extension 回归**：bot.ts 拆分 + 35 个扩展测试全绿

### 阶段 3：切换与清理（约 2–3 天）

- 蓝绿比对：v0.8.1 与 v0.9.0 同库并行，53 端点 diff 脚本逐一比对（结构级 diff，忽略时间戳）
- 文档重写：architecture / deployment / operations / CLAUDE.md / README / SUMMARY（沿用 v0.8.x 文档审计清单结论）
- 旧 utils 文件删除、tag v0.9.0

**总工作量估计：2.5–4 人周**（后端 1.5–2.5 + 前端 0.7–1 + 阶段 0/3 共享）。

## 验证策略

- 扩展 35 个 vitest 用例全程绿（契约回归）。
- API diff：53 端点录制 v0.8.1 响应，v0.9.0 逐一比对（结构级 diff，忽略时间戳）。
- 前端基线：关键页面（index/search/posts/[id]）SSR HTML 结构比对 + Lighthouse 性能基线（LQIP/CLS 不回退）。
- phash 抽样验证：新链路导入重复图，确认命中既有 phash 去重；`EXPLAIN` 确认前缀桶查询命中新表达式索引。
- 数据校验：posts/tags/post_tags 行数与 post_count 对账。
- 队列故障演练：pipeline 人为失败 → 重试 3 次 → 进 DLQ（验证 B3 补的缺口）。

## 明确不做

- 不新增 v0.8.1 之外的功能（本地 WD14 打标、Meilisearch 真接入、pools/收藏/黑名单等只进 ADR 或另立版本）。
- 不换前端框架、不做前后端分离换栈（Hono 方案存档）。
- 不改部署拓扑（仍单机 compose，容器数不增）。
- 不动生产数据的不可逆操作（所有迁移先 dry-run）。
- 档案馆化不做零 gutter（已定较小间距折中）；杂志视图不删除（保留为切换项）。

## 附：功能盘点摘要（feature parity checklist 基线）

- **API 端点 53 个**（52 路由文件）：posts 7、tags/search 3、tasks 4（含 SSE stream）、admin-* 12、admin/ai 6、auth 5、settings 4、auto-rating-rules 4、rebuild、bot webhook、`/i/[...]` 图片反代、`/health`。
- **前端**：index / search / posts/[id] / random / tags(2) / login / maintenance / admin(8 tab) / admin/import；关键组件 PhotoGrid(LQIP)、PostSeriesNav、SearchBar、AiAssistantPanel(5 子组件)、Toast/Confirm 体系。
- **数据模型**：posts（series 三列 + trgm GIN）、tags（trgm×3）、post_tags、tag_aliases、tag_knowledge、auto_rating_rules、settings(KV)、admins、extension_keys；物化视图 mv_dashboard_stats（5min 刷新）。
- **Nitro 插件 8 个**：pipeline-worker(BRPOP)、bot-setup、sync-tasks(1h reconcile)、seed-settings、redis-lifecycle、dashboard-refresh(5min)、redis-index-sync、seed-admin。
- **Sidecar**（Python 403 行）：gallery-dl 下载 + imagehash DCT phash + 元数据提取；SSRF 防护；Pixiv refresh-token + PHPSESSID。
- **Bot**（grammy，bot.ts 676 + bot-rating.ts 121）：BOT_ADMIN_IDS 白名单、每 chat 语言/信号量、9 个命令、评级确认 inline keyboard + 10s 倒计时。
- **Extension**（MV3）：content 注入导入按钮、background 调 web-import、popup 配置 kb_ext_ key；契约仅 2 端点。
- **AI**（ai.ts 735 行，OpenAI 兼容）：classifyTags(25/批) / suggestMerges / suggestRatings(进度回调) / generatePostSummary / adminAssistantChat(history) / job 系统(Redis `kura:ai_job:{id}`)。
