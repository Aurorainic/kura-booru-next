# v0.9.0 重构计划：功能复刻 + 技术栈开放选型

> 状态：草案，待外部工具调整后定稿执行。基准版本：v0.8.1（git tag `v0.8.1`）。

## 目标定义

v0.9.0 = **以 v0.8.1 功能为基准的全量重构**。复刻全部现有功能（feature parity），但内部架构重新设计；技术栈逐项开放评估，不默认沿用现状。

已完成的前置调研：

- 功能盘点：53 个 API 端点、~10 页面前端、10 表 + 3 枚举、8 个 Nitro 插件、sidecar/bot/extension/AI 四大功能域，总代码量约 server 6,300 行 + 前端 5,600 行 + sidecar 403 行 + 扩展 500 行。
- 技术调研：BullMQ vs pg-boss（2026 共识：BullMQ 是默认推荐；pg-boss 适合"已有 PG 不想再养 Redis"）、imgproxy（成熟自托管缩略图服务，注意 CVE-2025-24354 SSRF 需配置）、WD14/JoyCaption（本地打标生态，作为 AI 域演进参考）、booru 生态（Danbooru=Rails、szurubooru=Python 停滞、hydrus=桌面端；无现成替代品覆盖本项目"抓取+AI+扩展+bot"组合）。
- context7：Hono 生态（hono-openapi / zod-openapi 可自动生成 OpenAPI 规范）。

## 硬约束（任何方案都必须满足）

1. **数据兼容**：现有 Postgres 数据（posts/tags/post_tags/tag_knowledge/extension_keys 等 10 表）+ S3 对象 + Redis 队列语义必须无缝迁移或原地兼容。posts 系列三列 NULL 语义、物化视图、trgm 索引保留。
2. **phash 跨栈位一致**：现有 600+ 条 phash 由 Python `imagehash` DCT 生成。去重链路依赖它 —— **Python sidecar 必须保留**（gallery-dl 也是 Python 库，双重绑定）。后端语言怎么选都不影响这个结论。
3. **外部契约不变**：浏览器扩展（2 个端点 + `kb_ext_` key）、Telegram webhook（secret_token + callback 协议）、OpenAI 兼容 AI 端点 —— 三者是"对外 API 契约"，重构后必须原样工作，扩展 35 个测试可作为回归基准。
4. **部署形态不变**：单机 docker-compose，容器数不显著增加（现 4 个：web/worker/postgres/redis）。

## 两种候选方案

### 方案 A：同栈重构（Nuxt 4 保留，内部重架构）

技术栈：Nuxt 4 + Nitro + Vue 3 + Drizzle + PG + Redis 全部保留。

改什么：

- **分层重架构**：`server/routes/`（薄路由）→ `server/modules/<domain>/`（posts/tags/ai/import/auth/admin 各自 service + repo），消灭 utils 大杂烩（ai.ts 735 行、bot.ts 676 行、pipeline.ts 609 行拆分）。
- **队列抽象**：Redis list 自制队列收敛为接口 `JobQueue`，默认实现仍 Redis；评估 pg-boss 替代（少一个 Redis 依赖方向）或 BullMQ（2026 社区默认推荐）。AI job 进度系统并入统一 job 模型。
- **修正名不副实**：`MEILI_ENABLED` 实际走 RediSearch —— 要么改名 `REDISEARCH_ENABLED`，要么真接 Meilisearch/Typesense（评估后 ADR 决定）。
- **API 契约显式化**：53 个端点补 zod 校验 + 生成 OpenAPI 文档。
- 前端组件域重组（gallery / admin / ai / ui 四层目录），样式 token 收敛。
- 文档全量重写（沿用 v0.8.x 文档审计清单的结论，直接在新结构下写对）。

优点：风险最低、无数据迁移、复刻速度最快、部署不变。
缺点：架构上限受 Nitro 约束（约定式路由、auto-import 魔法仍在）。

### 方案 B：前后端分离重构（开放换栈）

技术栈（调研后推荐组合，每一项都在 ADR 中留备选）：

- **API 服务**：Hono（Node 22）+ zod-openapi（自动 OpenAPI）+ Drizzle + PG。理由：Web 标准、无魔法、薄、适合把 53 个薄路由写成显式契约；context7 评分 84，生态活跃。
- **前端**：保留 Vue 3 + Vite SPA（Pinia/无框架路由二选一），或评估 SvelteKit —— 若换 SSR 框架则首页/搜索页保留 SSR，admin 纯 SPA。默认建议：前台 SSR 用 SvelteKit 或继续 Nuxt 只作前端层。
- **队列**：pg-boss（PG 已有，SKIP LOCKED 成熟，可顺带把 AI job、dashboard 刷新、定时 reconcile 全收编；Redis 退化为纯缓存/限流/会话）——或减少组件方向。
- **缩略图**：评估 imgproxy 容器替代 sharp 内嵌（解放 API 进程 CPU；需配 `IMGPROXY_ALLOW_LOOPBACK_SOURCE_ADDRESSES=false` 等防 CVE-2025-24354）。决定权留给 ADR，sharp 为 fallback。
- **sidecar**：原样保留（Python + gallery-dl + imagehash），接口改为 pg-boss 或保留 Redis 队列。
- **bot**：grammy 逻辑搬进 API 服务模块（bot 协议简单，676 行重写成本可控）。

优点：架构干净（API/前端/队列/缩略图各司其职）、OpenAPI 契约天然适配扩展+bot 双客户端、Redis 可能移除（容器 4→3）。
缺点：工作量大（server 6,300 行 + 前端 5,600 行全量重写）、双语栈维护（TS+Python）、数据迁移脚本 + 双跑验证成本高、排错面变大。

## 共同执行阶段（两方案共享的阶段框架）

### 阶段 0：决策落地（ADR）

- 写 4-6 条 ADR：整体方案（A/B）、队列选型、搜索索引选型、缩略图方案、前端形态。
- 每条 ADR 基于本次调研结果 + 必要的 spike（如 pg-boss 最小 demo、imgproxy docker 跑通）。
- 产出物：`docs/adr/` 目录 + 定稿的 plan.md 技术栈一节。

### 阶段 1：骨架与契约冻结

- 冻结 53 端点 OpenAPI 契约（以现状为基准，扩展 2 端点 + bot webhook 标注为"不可变"）。
- 新目录骨架 + CI（typecheck + extension 35 测试 + 新增 API 契约测试）。
- 数据迁移方案：原地复用 PG（Drizzle schema 平移）或 dump/restore 脚本。

### 阶段 2：核心域复刻（按依赖序）

1. schema + 只读查询（posts/tags/search + trgm）→ 前台只读页面可用
2. auth（cookie session / BACKEND_API_KEY / extension keys 三种）
3. import 链路（enqueue → sidecar → pipeline → S3 → DB）
4. admin 全量（8 panel + dashboard MV）
5. AI 域（classify/merges/ratings/chat + job 进度）
6. bot + extension 回归（跑既有 35 个扩展测试）

### 阶段 3：切换与清理

- 蓝绿切换：v0.8.1 与 v0.9.0 同库并行，逐端点比对响应（diff 脚本）。
- 文档重写（architecture / deployment / operations / CLAUDE.md / README / SUMMARY）。
- 旧代码删除、tag v0.9.0。

## 验证策略

- 扩展 35 个 vitest 用例全程绿（契约回归）。
- API diff：对 53 端点录制 v0.8.1 响应，v0.9.0 逐一比对（结构级 diff，忽略时间戳）。
- phash 抽样验证：新链路导入重复图，确认命中既有 phash 去重。
- 数据校验：迁移后 posts/tags/post_tags 行数与 post_count 对账。

## 明确不做

- 不新增 v0.8.1 之外的功能（本地 WD14 打标、Meilisearch 换引擎等只进 ADR 评估，落地另立版本）。
- 不改部署拓扑（仍单机 compose）。
- 不动生产数据的不可逆操作（所有迁移先 dry-run）。

## 附：功能盘点摘要（feature parity checklist 基线）

- **API 端点 53 个**（server/routes/）：posts 7、tags/search 3、tasks 4（含 SSE stream）、admin-* 12、admin/ai 6、auth 5、settings 4、auto-rating-rules 4、rebuild、bot webhook、`/i/[...]` 图片反代、`/health`。
- **前端**：index / search / posts/[id] / random / tags(2) / login / maintenance / admin(8 tab) / admin/import；关键组件 PhotoGrid(LQIP)、PostSeriesNav、SearchBar、AiAssistantPanel(5 子组件)、Toast/Confirm 体系。
- **数据模型**：posts（series 三列 + trgm GIN）、tags（trgm×3）、post_tags、tag_aliases、tag_knowledge、auto_rating_rules、settings(KV)、admins、extension_keys；物化视图 mv_dashboard_stats（5min 刷新）。
- **Nitro 插件 8 个**：pipeline-worker(BRPOP)、bot-setup、sync-tasks(1h reconcile)、seed-settings、redis-lifecycle、dashboard-refresh(5min)、redis-index-sync、seed-admin。
- **Sidecar**（Python 403 行）：gallery-dl 下载 + imagehash DCT phash + 元数据提取；SSRF 防护；Pixiv refresh-token + PHPSESSID。
- **Bot**（grammy，797 行）：BOT_ADMIN_IDS 白名单、每 chat 语言/信号量、9 个命令、评级确认 inline keyboard + 10s 倒计时。
- **Extension**（MV3）：content 注入导入按钮、background 调 web-import、popup 配置 kb_ext_ key；契约仅 2 端点。
- **AI**（ai.ts 735 行，OpenAI 兼容）：classifyTags(25/批) / suggestMerges / suggestRatings(进度回调) / generatePostSummary / adminAssistantChat(history) / job 系统(Redis `kura:ai_job:{id}`)。
