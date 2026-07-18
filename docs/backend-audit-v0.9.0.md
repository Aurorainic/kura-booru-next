# Kura Booru Next — 后端审计报告（v0.9.0 重构决策依据）

> 审计基准：v0.9.0 分支工作区（基于 v0.8.1，最新提交 `20d8600`）。
> 方法：通读 `server/` 全部 97 个文件（6,083 行）、`drizzle/` 6 个迁移、`sidecar/sidecar.py`（403 行）、`nuxt.config.ts`、`package.json`、`infra/docker-compose.yml`。`extension/` 未细读（契约已知：2 端点 + `kb_ext_` key）。
> 所有结论附 `文件:行号` 证据。本次审计未改动任何业务代码。

---

## 0. 总量核对（与 plan.md 的偏差）

| 指标 | plan.md 估计 | 实测 | 证据 |
|---|---|---|---|
| server 总行数 | ~6,300 | **6,083**（97 个 .ts） | `wc -l $(find server -type f)` |
| API 端点 | 53 | **52 个路由文件 = 53 个端点**（`tags/index.get.ts` 一个文件同时服务 `/api/tags` 与 `/api/tags/:name`，见该文件 L8-15 的 catch-all 注释） | `find server/routes -name "*.ts"` = 52 |
| Nitro 插件 | 8 | 8 ✓ | `server/plugins/` |
| 表/枚举 | 10 表 + 3 枚举 | ✓ | `server/schema/`、`server/schema/enums.ts:3-5` |
| ai.ts / bot.ts / pipeline.ts | 735 / 676 / 609 | 全部吻合 ✓ | `wc -l` |
| sidecar | 403 行 | ✓ | `sidecar/sidecar.py` |
| bot "797 行"（plan 附录） | — | 实为 bot.ts 676 + bot-rating.ts 121 = 797，两文件合计 | `wc -l server/utils/bot*.ts` |

结论：plan.md 的盘点数字准确，可直接作为 feature parity 基线。

---

## 1. 架构现状图

### 1.1 目录结构（行数为实测）

```
server/                                    6,083 行 / 97 文件
├── routes/                                52 文件（53 端点），绝大部分 20-90 行的薄路由
│   ├── api/posts/          7 端点         index.get / [id].get / [id].patch / [id].delete /
│   │                                      [id]/tags.put / random.get / by-source.get
│   ├── api/search/         1 端点         index.get（纯转发到 queries.searchPosts）
│   ├── api/tags/           2 文件 3 端点  index.get（list + /:name 二合一）、autocomplete.get
│   ├── api/tasks/          4 端点         index.post / web-import.post / web-import/stream.get(SSE) / [id].get
│   ├── api/admin/ai/       6 端点         chat / classify-tags / suggest-merges / suggest-ratings /
│   │                                      jobs/[id].get / status.get
│   ├── api/admin/tags/     8 端点         index.get / [id].patch / merge / reprocess /
│   │                                      fix-artist-categories / aliases×3
│   ├── api/admin/dashboard 2 端点         index.get / system-status.get
│   ├── api/admin/extension-keys 3 端点    index.get / index.post / [id].delete
│   ├── api/admin/settings  2 端点         index.get / index.put
│   ├── api/auth/           4 端点         login / logout / status / change-password
│   ├── api/settings/       5 端点         index.get / index.put / public.get / test-pg / test-redis
│   ├── api/auto-rating-rules 3 端点       index.get / index.post / [id].delete
│   ├── api/rebuild/        1 端点         index.post（CDN PURGE 转发）
│   ├── bot/webhook.post.ts 1 端点         Telegram webhook
│   ├── i/[...].ts          1 端点         S3 图片反代（流式 + Range 转发）
│   ├── health.get.ts       1 端点         {status:'ok'}
│   └── logout.post.ts      1 端点         清 cookie + 302（SSR 页面路径，非 /api）
├── middleware/ (5)          249 行        00-security-headers(16) / 01-ssr-context(62) /
│                                          02-cache-control(96) / 03-cors(51) / 04-extension-auth(22)
├── plugins/ (8)             322 行        见 §3.4
├── schema/ (11)             ~200 行       10 表 + enums + index re-export
└── utils/ (21)             3,540 行       全部业务逻辑集中地；4 个 >300 行文件占 2,545 行（72%）
    ├── ai.ts 735 / bot.ts 676 / pipeline.ts 609 / queries.ts 525   ← 四大巨型文件
    ├── auth.ts 183 / search/suggest.ts 145 / series-admin.ts 136 / extension-auth.ts 126 /
    │   bot-rating.ts 121 / settings.ts 119 / queue.ts 114
    └── 其余 ≤60 行：db / redis / s3 / phash / sanitize / rate-limit / url-patterns /
        auth-helpers / admin-identity / schema(re-export)
```

### 1.2 分层现状（事实判断）

- **路由层已经很薄**：52 个路由中约 45 个只做「鉴权 → readBody 手工校验 → 调 utils → 返回」，典型 30-60 行。plan.md「薄路由 → modules」的方向里，路由层本身不是痛点。
- **痛点在 utils 层**：3,540 行里 72% 集中在 4 个巨型文件，且互相交叉调用（bot.ts 调 queries/queue/ai/bot-rating/url-patterns 五个模块；pipeline.ts 调 ai.ts 的 `aiProcessTagsForPost`（pipeline.ts:234, 604），ai.ts 又直接操作 posts/tags 表）——没有领域边界，是按「技术职能」而非「业务域」堆的。
- **auto-import 隐式依赖网**：ai.ts 只显式 import 了 `isNull, asc`（`server/utils/ai.ts:8`），但全文使用 `db / posts / tags / tagKnowledge / eq / sql / inArray / and / desc`——全部来自 Nitro auto-import。两个后果：(a) 无法直接用 tsx/vitest 跑单测，必须起 Nuxt 上下文；(b) 已出过一次真实 bug——bot-rating.ts L73-79 注释记载：auto-import 把别处的 `redis` 重命名为 `redis$1`，本文件裸写的 `redis.set` 静默变成 `undefined`，运行时 TypeError 中断了评级确认流。

---

## 2. 巨型文件解剖

### 2.1 ai.ts（735 行）— 可拆分性：最容易

| 职责块 | 行区间 | 内容 | 对外被谁依赖 |
|---|---|---|---|
| 类型定义 | L10-58 | AiMessage / TagClassification / AiJobStatus / MergeSuggestion 等 8 个 interface | 路由层 admin/ai/* |
| 配置 | L60-82 | `getAiConfig/isAiEnabled/getAiStatus`，直接读 4 个 env | status.get、pipeline、bot |
| OpenAI 客户端 | L84-154 | `callAiOnce/callAi`：fetch `{endpoint}/chat/completions`（L100）、30s 超时、429/5xx 重试 2 次 + jitter 退避 | 全部 AI 能力 |
| 标签分类 | L156-230 | CLASSIFY_SYSTEM_PROMPT（27 行内联 prompt）+ `classifyTags`（25/批，L192） | classify-tags.post、reprocessTags、aiProcessTagsForPost |
| pipeline 集成 | L232-312 | `aiProcessTagsForPost`：tag_knowledge 缓存查找 → 分类 → 回写 tags/posts | pipeline.ts:234, 604 |
| 批量重处理 | L314-371 | `reprocessTags`（含手写 `UPDATE ... FROM (VALUES ...)` 批量 SQL，L352-360） | reprocess.post、bot /aitags |
| 合并建议 | L373-429 | `suggestMerges`（top50 + bottom150 采样策略，L383-392） | suggest-merges.post |
| 评级建议 | L431-553 | `suggestRatingForPost`（STRONG_SIGNALS 硬编码词表 L449-457）+ `suggestRatings`（进度回调） | suggest-ratings.post、bot pollAndNotify |
| 摘要生成 | L555-578 | `generatePostSummary`（中文 prompt） | bot /info |
| 管理助手 | L580-676 | ASSISTANT_SYSTEM_PROMPT + `adminAssistantChat` + `gatherAssistantContext`（11 个并发 count 查询，L644-656） | chat.post、bot /ai |
| AI job 进度 | L688-735 | Redis `kura:ai_job:{id}`，TTL 1800s 运行中 / 60s 完成后 | 3 个 admin/ai 路由 + jobs/[id].get |

**耦合度**：块间几乎不互相调用（都通过 `callAi` 收敛），但每个能力块都直接内联 DB 查询（无 repo 层），prompt 与代码混排。**拆分难度最低**：按能力切成 `ai/client.ts + ai/classify.ts + ai/ratings.ts + ai/merges.ts + ai/assistant.ts + ai/jobs.ts` 是纯机械移动，唯一需要做的是把 auto-import 换成显式 import。

### 2.2 bot.ts（676 行）— 可拆分性：中等偏难

| 职责块 | 行区间 | 内容 |
|---|---|---|
| 初始化 + 配置 | L14-32 | grammy Bot 实例、BOT_ADMIN_IDS 白名单、lazy init |
| 中间件 ×2 | L34-67 | admin 鉴权（L35-50）、每 chat 语言加载（L53-67，含新旧 key 迁移 `kura:bot:lang:` ← `kura:bot_lang:`） |
| 并发信号量 | L69-92 | 每 chat 上限 3 的内存信号量（进程内 Map，重启即丢） |
| i18n 文案表 | L94-190 | zh/en 两张表 ~95 行 + `t()` + `i18nLabels`（与 bot-rating.ts L9-22 的 L 表**内容重复**，两处各自维护） |
| 9 个斜杠命令 | L192-447 | start/search/random/stats/autopass/lang/info/save/aitags/ai |
| 5 个 `!` 别名 | L349-460 | !save/!search/!random/!info/!ai——与斜杠命令**逻辑逐句重复**（如 !search L364-374 vs /search L205-226） |
| URL/图片消息处理 | L462-555 | message:text + message:photo 两个 handler，各含 SSRF 预检 + 信号量 + enqueue + poll，两者间也近乎重复（L481-497 vs L528-542） |
| callback_query | L557-601 | `rate:` / `random:another` / `post:` 三路分发 |
| 轮询通知 | L603-676 | `pollAndNotify`（依赖 queue.pollJobResult，300s 超时，L611）+ `showRatingMenu`（10s 倒计时，timer 实体在 bot-rating.ts） |

**耦合度**：对外依赖 5 个 utils（queries/queue/ai/bot-rating/url-patterns）+ redis + db，是全 server 扇出最大的文件；但每个 handler 内部逻辑直白。**拆分路径**：i18n 表抽成 `bot/i18n.ts`（并消灭与 bot-rating.ts 的重复）→ 命令按域分组 `bot/commands/*.ts` → `!` 别名改为同一 handler 双注册，可消 ~80 行重复 → 两个消息 handler 提取公共 `enqueueUrls()` 再消 ~30 行。难点在 grammy 的 BotContext flavor（L6-12）拆分后要保持单一声明点。

### 2.3 pipeline.ts（609 行）— 可拆分性：中等（主要问题是重复）

- `processResult` 单图路径（L31-249）与 `processMultiImageResult` + `insertOnePage` 多图路径（L262-609）之间，**五个步骤块逐行重复**：
  1. phash 去重（L64-78 ≈ L433-448，仅单图返回 duplicate、多图抛 `PIPELINE_DUP` 错误码不同）
  2. sharp 缩略图三件套 thumb/preview/LQIP（L95-115 ≈ L460-476，参数完全一致：300²/1280/20² webp）
  3. S3 三路并发上传（L127-131 ≈ L484-488，逐行相同）
  4. auto-rating 规则扫描（L147-164 ≈ L496-510，逐行相同）
  5. tags 批量 upsert + artist 专门 upsert + post_tags 插入的事务（L169-230 ≈ L515-601）
- 保守估计 **~150-180 行是纯重复**。多图路径独有的复杂度：legacy 单行收养（L291-318）、series_id 预生成防竞态（L298-315，注释记录了 insert-then-update 读回竞态的修复史）、23505 并发败者恢复（L349-372）、page_count 对账（L383-389）。
- **拆分路径**：提取 `pipeline/steps/`（dedup/thumbnails/upload/rating/tags 五个纯函数步骤）后，单图与多图各剩 ~80 行编排。多图的事务/竞态逻辑是本项目最精细的并发代码，拆分时必须保留注释中的决策记录。

### 2.4 queries.ts（525 行）— 可拆分性：容易，但要想清楚边界

四类内容混在一个文件：序列化器（L12-58，snake_case 投影 + 剥离 phash）、搜索语法解析（L60-102）、posts 查询（L129-263）、tags 查询（L366-497）+ auto-rating（L499-517）。它已是事实上的「read repo」，拆分主要是按 posts/tags 分家。注意 L7 还 re-export drizzle 操作符供路由使用——这是 auto-import 之外的第二个隐式依赖通道。

### 2.5 拆分难度排序（实证）

**ai.ts（最易）→ queries.ts → pipeline.ts（重复多但步骤纯净）→ bot.ts（扇出最大、重复模式最碎、grammy context 牵连）**

---

## 3. 队列与异步现状

### 3.1 Redis 自制队列：不是「一个队列」，是跨两语言三进程的 4-key 状态机

```
生产者(web)                sidecar(worker)               pipeline-worker(web)           结果消费者
─────────────              ─────────────────              ─────────────────────         ─────────────────
LPUSH kura:jobs      ──▶   BRPOP kura:jobs (阻塞∞)
{ id, url,                 sidecar.py:387
  source_site,             SET kura:job_status:{id}=processing (EX 7200)   sidecar.py:255
  source_id }              gallery-dl 下载 + imagehash phash
queue.ts:65-78             SET kura:results:{id}={原始结果含 image_bytes_b64+phash} (EX 3600)  sidecar.py:369
                           LPUSH kura:pending_results {id}                 sidecar.py:374
                                                  ──▶  BRPOP kura:pending_results (阻塞∞)  01-pipeline-worker.ts:23
                                                       processResult()（去重/缩略图/S3/DB）
                                                       覆盖写 kura:results:{id}={安全结果} (EX 300)  worker L61-66
                                                       SET kura:job_status:{id}=done (EX 300)       worker L68
                                                                                  ──▶ 三路消费：
                                                                                      ① bot pollAndNotify → pollJobResult 每 500ms GET job_status（queue.ts:80-102；唯一调用点 bot.ts:611）
                                                                                      ② SSE stream 每 2s GET kura:results（stream.get.ts:24-58）
                                                                                      ③ GET /api/tasks/[id] 轮询 job_status+results
                                                                                  可选元数据：kura:job_meta:{id}（force_rating，EX 3600，queue.ts:75 写，worker L48-55 读）
```

- **key 命名全景**（grep 实测，按用途分）：队列族 `kura:jobs / kura:pending_results / kura:results: / kura:job_status: / kura:job_meta:`；AI job 族 `kura:ai_job:{id}`；bot 状态 `kura:bot:lang: / kura:bot:autopass:`；审计 `kura:ext_force_rating_audit`（LPUSH+LTRIM 保留 1000 条，web-import.post.ts:49-63）；会话纪元 `kura:password_epoch`；限流 `rl: / login:fail: / login:lock: / apikey:rate:`；搜索索引 `kura:tagidx` + `tag:{id}` HASH。
- **重试机制**：`queue.ts:104-113` 定义了 `MAX_RETRIES=3` + 指数退避的 `handleJobWithRetry`——**但 grep 全仓零调用点，是死代码**。实际失败语义：sidecar 捕获一切异常写 `status:error`（sidecar.py:364-366）；pipeline-worker 出错只 console.error + sleep 1s（worker L71-75），**失败结果永不写回 job_status=done/error，调用方只能等 300s 轮询超时**。无 DLQ、无重投、无 at-least-once 保证（BRPOP 取出即丢，worker 进程崩溃 = 该 job 永久悬挂）。
- **redis 客户端封装隐患**：`redis.ts:23-28` 用 Proxy 把所有方法名大写化转发。同仓并存两种命令风格：对象式 `redis.set(k, v, { EX: 3600 })`（queue.ts:75）与变参式 `(redis as any).set(k, v, 'EX', 300)`（01-pipeline-worker.ts:61-66）——Proxy 照单全收，类型系统完全失效（满处 `as any`）。
- **BRPOP 专用连接**：`redis.ts:33-40` 单独 `_blockingClient`，避免阻塞共享连接；05-redis-lifecycle.ts 在 nitro close 时 quit（注释记载热重载导致 4 天 36k 连接泄漏的历史）。

### 3.2 AI job 进度系统（第二套「队列」）

- 存储：Redis `kura:ai_job:{id}`，运行中 TTL 1800s、完成后缩到 60s（ai.ts:692-693）。
- 触发：3 个 admin/ai 路由用 **`event.waitUntil` fire-and-forget** 在响应后继续跑（classify-tags.post.ts:41、suggest-merges.post.ts:15、suggest-ratings.post.ts:20），进度经 `updateAiJobProgress` 写回，前端轮询 `GET /api/admin/ai/jobs/[id]`。
- 特征：进程内执行——web 进程重启 = job 丢失（Redis 里只剩 running 僵尸记录直到 TTL）。`waitUntil` 是 h3/Nitro 特有 API，是换框架时的隐藏迁移点。

### 3.3 SSE：全站仅 1 处

`tasks/web-import/stream.get.ts`：admin 专属，最多 50 个 task_id，每 2s 轮询 `kura:results:{id}`，5 分钟硬截止，事件类型 `progress/ping/done`。实现是手工拼 `event: x\ndata: y\n\n` 帧 + `sendStream`（L13-16, L68-71）。bot 侧不用 SSE 而是 500ms 轮询（queue.ts:80-102）。

### 3.4 8 个 Nitro 插件实测

| 插件 | 行数 | 触发方式 | 职责 |
|---|---|---|---|
| 01-pipeline-worker | 77 | 启动时 fire-and-forget 无限 BRPOP 循环 | sidecar 结果 → pipeline → 回写状态（§3.1） |
| 02-bot-setup | 57 | 启动一次 | setWebhook（带 secret_token；生产缺 secret 直接 throw，L27-30）+ setMyCommands ×10 |
| 03-sync-tasks | 26 | `setInterval` 1h + 启动后 10s 首跑 | tag post_count 全量对账（一条 UPDATE 子查询 SQL，L16-18） |
| 04-seed-settings | 24 | 启动一次（表空才种） | env → settings KV |
| 05-redis-lifecycle | 21 | nitro `close` hook | 关闭两个 redis 连接 |
| 06-dashboard-refresh | 27 | `setInterval` 5min + 30s 首跑 | `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_stats` |
| 07-redis-index-sync | 43 | 启动一次（后台） | 全量重建 RediSearch tag 索引（仅 MEILI_ENABLED=true 时，L18 早退） |
| seed-admin | 25 | 启动一次 | 无 admin 时建号；未设密码则生成随机密码打日志（L11-16） |

**本质**：Nitro 插件在这里被当作「穷人版 job runner / cron / 启动钩子」三合一。没有统一抽象——两个 setInterval、一个无限循环、四个启动钩子、一个 close 钩子，各自为政。

### 3.5 换 pg-boss / BullMQ 的真实迁移面

**生产者点（6 处 enqueueJob 调用）**：
`tasks/index.post.ts:22`、`tasks/web-import.post.ts:76`、`bot.ts:341`（/save）、`bot.ts:356`（!save）、`bot.ts:492`（message:text）、`bot.ts:537`（message:photo）。

**消费者/状态读取点（7 处）**：
`sidecar/sidecar.py:387`（BRPOP kura:jobs，Python）、`sidecar.py:369-374`（写结果 + 通知）、`plugins/01-pipeline-worker.ts:23`（BRPOP pending_results）、`queue.ts:80-102`（pollJobResult，唯一调用 bot.ts:611）、`stream.get.ts:24-58`（SSE 轮询）、`tasks/[id].get.ts`（状态字符串翻译）、AI job 族（ai.ts:696-735 + 3 个路由 + jobs/[id].get.ts）。

**关键约束（plan.md 未充分展开的）**：

1. **pg-boss/BullMQ 都是 Node-only**。Python sidecar 无法成为它们的消费者——要么 sidecar 直接轮询 pg-boss 的 PG 表（等于自己实现半个客户端），要么保留 Redis 队列专供 sidecar（那「去掉 Redis」就落空），要么把队列协议改成 HTTP 回调（sidecar 变 web hook 接收方，架构变化最大）。
2. **要迁移的不是 LPUSH/BRPOP 本身（半天的事），而是结果回取协议**：`kura:results:` / `kura:job_status:` 的 TTL 语义、bot 的 500ms 轮询、SSE 的 2s 轮询、extension 依赖的状态字符串（`queued/in_progress/complete/duplicate/too_large/failed`——tasks/[id].get.ts:14-22 的注释明确记载 extension content.js 依赖 `in_progress` 这个字面量）。这套协议有 **3 个外部消费方**（bot、extension、SSE 前端），是契约敏感面。
3. **Redis 的非队列用途有 8 类**（会话纪元、登录锁定、限流 ×3、bot 语言/autopass、AI job 进度、审计 list、RediSearch 索引）。pg-boss 只能收编队列族 + AI job + 两个 setInterval 定时器；其余仍需要 Redis 或另找存储。「容器 4→3」的前提是把这 8 类也迁走，工作量远超队列本身。

---

## 4. 数据层

### 4.1 Schema 要点（10 表 + 3 枚举 + 1 物化视图）

- **posts**（`server/schema/posts.ts`，45 行）：22 列。series 三列 `series_id/page_index/page_count` 全 NULLable、无回填（L22-26 注释记录 2026-07-14 决策：604 条存量保持 NULL=单图语义）。唯一索引 `ix_posts_source_site_id_page (source_site, source_id, page_index)`——利用 PG「NULL 互不相等」语义让 legacy 单行与 series 页共存（L34-40 注释 + `drizzle/0005_post_series.sql:30-38`）。`phash` 有普通 btree（L44），但 pipeline 实际用 `left(phash,4)=prefix` 查询（pipeline.ts:69）——**普通 btree 无法服务 left() 表达式**，前缀桶查询走不到该索引（数据量小无感，但属「索引存在却用不上」的隐性问题；需 `text_pattern_ops` 或表达式索引）。
- **tags**（`server/schema/tags.ts`）：3 个 trgm GIN（name/translation/danbooru_name）+ post_count btree。`postCount` 是冗余计数，由 pipeline 增量维护 + 03-sync-tasks 每小时全量对账兜底。
- 其余 8 表：post_tags（复合 PK，双 FK cascade）、tag_aliases、tag_knowledge（AI 分类缓存；type/source 刻意用 text 不用 enum，`tag_knowledge.ts` 注释）、auto_rating_rules、settings（KV + version 列但代码中未见使用）、admins、extension_keys（sha256 hash + revoked_at 软删除 + can_force_rating 能力位，`extension_keys.ts:17-21`）。
- 3 枚举：`source_site / tag_category / rating`（enums.ts:3-5）。
- **物化视图** `mv_dashboard_stats`（`drizzle/0003_dashboard_mv.sql`）：哨兵行 id=1，5 个聚合列，unique index 支持 CONCURRENTLY 刷新，由 06-dashboard-refresh 每 5min 刷新。dashboard 路由只从 MV 读总量、分组明细仍实时查（dashboard/index.get.ts:33-41；注释记载 `db.select().from(sql`...`)` 列名映射失败的坑，改用 `db.execute()`）。

### 4.2 查询分布：半集中

- **集中部分**：全部前台只读查询（listPosts/getPost/getRandomPost/getPostBySource/searchPosts/listTags/autocomplete/getTagByName）收敛在 `queries.ts`（525 行）——现状里最接近「repo 层」的东西。
- **散落部分**：`sql` 手写 SQL 分布在 **18 个文件**（grep 实测）：routes 层 6 个（merge.post、fix-artist-categories、tags.put、dashboard/index.get、admin/tags/index.get、classify-tags.post）、utils 6 个（ai.ts、bot.ts、pipeline.ts、queries.ts、suggest.ts、series-admin.ts）、plugins 3 个、schema 2 个。写路径（pipeline 事务、merge、fix-artist、series 删除重编号）全部绕过 queries.ts 各自为战——**读集中、写散落**。
- 典型手写 SQL：批量 `UPDATE ... FROM (VALUES ...)`（ai.ts:352-360）、`UPDATE post_tags ... WHERE NOT IN`（merge.post.ts:41-47）、series 重编号单语句 CASE（series-admin.ts:111-119）、dashboard MV 读取。

---

## 5. 搜索现状：MEILI_ENABLED 名不副实的完整证据链

**三重名不副实**：

1. **不是 Meilisearch**：`MEILI_ENABLED=true` 实际开启的是 **RediSearch**。全部实现位于 `server/utils/search/suggest.ts`：`FT.CREATE kura:tagidx ON HASH PREFIX 1 tag: SCHEMA name TEXT SORTABLE, category TAG, post_count NUMERIC SORTABLE`（L24-36）；查询 `FT.SEARCH @name:%prefix%`（L86-90，1 字符容错、超取 3x 后用 SQL EXISTS 过滤 non-safe）。零新增依赖，直接 `sendCommand`（L5-6 注释）。
2. **不管「搜索」只管「自动补全」**：`/api/search`（search/index.get.ts）→ `searchPosts`（queries.ts:267-364）是**纯 SQL**：tag 解析 + EXISTS/NOT EXISTS 子查询 + rating/source 过滤，**完全不经过 RediSearch**。RediSearch 唯一服务的端点是 `/api/tags/autocomplete`（autocomplete.get.ts:9 → `suggestTags`）。
3. **索引新鲜度半失守**：同步 = 启动全量重建（07-redis-index-sync.ts；`MEILI_ENABLED!=='true'` 时整体 no-op，L18）+ 写穿透仅挂在 `admin/tags/[id].patch.ts:54`（`upsertTagIndex`）。**pipeline 导入时 post_count 自增不触发索引更新**（pipeline.ts:176 只改 PG），03-sync-tasks 对账也只修 PG——索引里的 post_count 排序权重持续漂移，直到下次重启重建。`deleteTagIndex`（suggest.ts:51-54）定义后**全仓无调用点**（merge 删 tag、fix-artist 删 tag 都不同步索引）。

**真实搜索链路结论**：tag 组合搜索 = PG EXISTS 子查询（正确、够用）；自动补全 = RediSearch（可选增强，SQL ILIKE 兜底，suggest.ts:64-71）。决策时的真实选项：(a) 改名 `REDISEARCH_ENABLED` + 补写穿透/删除同步（小修）；(b) 直接删掉改用 PG trgm ILIKE（已有 4 个 GIN 索引，1.5k tags 量级性能无差，少一个活要干）；(c) 真接 Meilisearch——按当前数据量（数百 posts、1.5k tags）没有收益证据。

---

## 6. 对外契约面（重构时「不可变」清单的代码坐标）

| 契约 | 实现位置 | 敏感点 |
|---|---|---|
| **扩展端点 ①** `POST /api/tasks/web-import` | `routes/api/tasks/web-import.post.ts`（86 行） | `X-Api-Key: kb_ext_*`（04-extension-auth.ts:14-21 中间件按前缀识别）；请求体 `{urls[], force_rating?}`；响应 `{results:[{task_id, status, url, error?}]}`；`key_not_authorized_for_force_rating` 是扩展 UI 依赖的字面错误码（L74-77）；per-key 60/min 限流（L12-19） |
| **扩展端点 ②** `GET /api/tasks/[id]` | `routes/api/tasks/[id].get.ts`（44 行） | 状态字面量契约：`queued/in_progress/complete/duplicate/too_large/failed`；`processing→in_progress` 翻译的注释明确记载 extension content.js 轮询依赖（L14-22）；响应剥离 `image_bytes_b64/phash`（L31-35，安全敏感，回归必测） |
| **Telegram webhook** `POST /bot/webhook` | `routes/bot/webhook.post.ts`（28 行） | `x-telegram-bot-api-secret-token` 校验（L8-17；生产缺 secret 拒绝注册，02-bot-setup.ts:27-30）；body 直通 `bot.handleUpdate`（grammy）；callback_data 协议 `rate:{postId}:{rating}` / `post:{id}` / `random:another`（bot.ts:564-593）是隐式契约 |
| **OpenAI 兼容 AI（出向）** | `utils/ai.ts:99-131` | 本项目是客户端：`POST {AI_PROVIDER_ENDPOINT}/chat/completions`，Bearer key，`response_format: json_object`。重构只需保持出向调用，无对外暴露面 |
| **`/i/` 图片反代** | `routes/i/[...].ts`（43 行） | 透传 Range → S3（L18-22）、流式 body 不落内存（L30-38）、`cache-control: public, max-age=31536000` 但刻意不加 `immutable`（L15-16 注释：key 可重传）；错误时 502/透传状态码语义 |
| **BACKEND_API_KEY（服务间）** | `utils/settings.ts:109-118` `checkApiKey` | timingSafeEqual、fail-closed；消费方 5 处：tasks/index.post、tasks/[id].get、posts/[id].patch、dashboard/index.get、rebuild/index.post；bot-rating.ts:81-84 用它自调 `PATCH /posts/:id`（bot → HTTP 环回，INTERNAL_API_URL 已含 /api，L76-79 注释记载 /api/api 404 的坑） |

---

## 7. 横切问题

### 7.1 错误处理：模式统一但无兜底

- 路由层高度一致：`throw createError({statusCode, statusMessage})`，全仓 **103 处**（grep 实测），h3 默认错误序列化兜住。
- utils 层两种方言：`Object.assign(new Error(...), { statusCode: 503 })`（ai.ts:96、auth.ts 改密处）vs 裸 `throw new Error` + 自制 `code`（pipeline.ts:444-447 的 `PIPELINE_DUP`）。
- **无统一错误响应形状**（没有 code 字段，前端只能字符串匹配 statusMessage；扩展依赖的 `key_not_authorized_for_force_rating` 之类字面量散落在各路由）；无 request-id、无集中错误日志。
- 「非 safe 即 404」的内容隐藏契约写在 queries.ts:161-163 + getPost series 分支（L180-216 详细注释）——跨端点的安全不变量，重构必须原样保留。

### 7.2 输入校验：无 zod，纯手工

- `package.json` 无 zod（grep 全仓 0 命中）。每个路由 `readBody<{...}>(event)` + 手写存在性/枚举校验。
- 枚举值硬编码重复 ≥4 处：VALID_RATINGS（web-import.post.ts:5）、allowed rating（posts/[id].patch.ts:24-26）、VALID_CATEGORIES（admin/tags/[id].patch.ts:30-32，注释自己承认「mirrors the enum」）、VALID_SOURCES（pipeline.ts:59 与 L273 重复两次）。PG enum 才是真源，这些 list 漂移时不报错、只静默放行/拒绝。
- 深度较好的例子：extension key 名长度 1-64（extension-keys/index.post.ts:13-16）、rebuild path 同源 SSRF 校验（rebuild/index.post.ts:30-48）、test-pg/test-redis 的 scheme 白名单 + DNS pin 防重绑定（test-pg.post.ts:29-42）。
- 结论：**补 zod 的收益真实存在**（消 4 处枚举重复、给 53 端点出 OpenAPI 契约），但属「逐端点加 schema」的体力活，与框架选择无关——Nitro 下 h3 一样可以用 zod。

### 7.3 Auth 三方式的实现与重复度

| 方式 | 实现 | 消费面 |
|---|---|---|
| Cookie session | `utils/auth.ts`（183 行）：HMAC-SHA256 签名 cookie `value.iat.sig`（L35-67）、bcryptjs(cost 12)、Redis `kura:password_epoch` 改密失效（L156-168）、双层内存缓存（adminCache 30s/256 条 L74-77 + epochCache 10s）、生产缺 SESSION_SECRET 直接 throw（L11-13） | `getIsAdmin` 全仓 **48 次调用**，其中 ~40 次是路由里逐字重复的三行样板（取 cookie → getIsAdmin → 401） |
| BACKEND_API_KEY | `settings.ts:109-118` timingSafeEqual，fail-closed | 5 个端点（见 §6）；posts/[id].patch.ts:32-41 与 dashboard/index.get.ts:16-25 的「30/min/IP 限流 + console.warn 审计」块**逐字重复** |
| Extension keys | `04-extension-auth.ts` 中间件（前缀识别、不强制）+ `extension-auth.ts`（sha256、timingSafeEqual L92-97、revoked_at、canForceRating、last_used_at 异步更新 L99-103）+ `auth-helpers.ts` `requireAdminOrExtensionKey` 判别联合 | 仅 web-import.post.ts 一处真正消费；中间件对每个带 `kb_ext_` 头的请求打一次 DB |

重复度评估：**session 三行样板 ×40、apikey 限流块 ×2**——一个 `defineAdminHandler / defineApiKeyHandler` 包装即可消灭，是「分层重架构能解决」的典型痛点，不需要换框架。

### 7.4 日志与配置

- **日志**：仅 `console.log/warn/error`，无结构化、无级别控制、无 request 上下文。安全审计靠 `console.warn('[audit] ...', {json})`（posts/[id].patch.ts:41、dashboard/index.get.ts:27）。Docker 部署下靠 stdout 收集，够用但不可检索。
- **配置**：无中央 config 模块。`process.env` 散落全 server（ai.ts:62-67、bot.ts:14-16、pipeline.ts:53、db.ts:6、redis.ts:4、s3.ts:7-15、auth.ts:9…）。`nuxt.config.ts:33-40` 的 runtimeConfig 只承载 internalApiUrl + 3 个 public 变量，server 代码并不走它——runtimeConfig 形同虚设。环境变量完整清单没有单一出处（只能去 infra/docker-compose.yml + 逐文件 grep 拼）。

---

## 8. 重构 vs 优化：实证判断

### 8.1 「分层重架构（方案 A）就能解决」的痛点

1. **utils 四大巨型文件**——§2 已给出逐文件拆分路径，全部是同栈内的机械移动 + 显式 import 化。最大单项收益：pipeline.ts 消 150-180 行重复、bot.ts 消 `!` 别名与双消息 handler 的 ~110 行重复、i18n 双表合一。
2. **auth 样板 ×40 + 限流块 ×2 + 枚举硬编码 ×4**——handler 包装 + zod 即消，纯同栈工作。
3. **队列抽象**——生产者只有 6 个调用点、`enqueueJob/pollJobResult` 已是准接口（queue.ts 仅 114 行），收敛为 `JobQueue` 接口成本极低；死代码 `handleJobWithRetry`（queue.ts:106-113，零调用）顺手删。
4. **MEILI_ENABLED 改名/收敛**——§5，半天工作量。
5. **配置集中 + 日志最小结构化**——新增 `server/config.ts` 单一出处，与框架无关。
6. **读集中/写散落**——把 6 个 routes + 3 个 utils 里的手写 SQL 收进 repo 层，queries.ts 按域拆分。

### 8.2 「Nitro 框架本身约束」导致的痛点（方案 A 解决不了）

1. **auto-import 魔法是真实故障源**（bot-rating.ts L73-79 的 `redis$1` bug 实录），且让 utils 无法脱离 Nuxt 上下文单测。方案 A 可缓解（全部改显式 import）但机制仍在——新增代码随时可能再踩。
2. **没有正经的后台任务抽象**：8 个插件 = 2 个 setInterval + 1 个无限 BRPOP + 1 个 close hook + 4 个启动钩子的杂牌军（§3.4）；AI job 靠 `event.waitUntil` 续命（进程重启即丢，§3.2）。Nitro 没有 cron/worker 概念，这是框架留白，方案 A 只能继续「插件里手写」。
3. **routeRules 缓存曾经咬过人**（nuxt.config.ts:42-62 注释实录：SWR 缓存 key 不含 cookie，把 anon HTML 回给了刚登录的 admin），被迫手工写 96 行 cache-control 中间件（02-cache-control.ts）绕过框架机制——框架默认值不可信，要自己兜底。
4. **middleware 靠文件名数字前缀排序**（00-04）、SSR 上下文靠 middleware 塞 `event.context`（01-ssr-context.ts）——可用但隐式，理解成本高。

### 8.3 换 Hono（方案 B）必须重建的清单

route 层搬运确实容易（52 个薄路由，`readBody/getQuery/createError` → Hono 对应物，约 2,000 行机械翻译）。但以下必须**重建而非搬运**：

| 必须重建 | 现状坐标 | 工作量性质 |
|---|---|---|
| 8 个 Nitro 插件 → 自有 bootstrap + scheduler | §3.4 | 中：pipeline-worker 的 BRPOP 循环、2 个 interval、bot webhook 注册、4 个启动 seed 都要新家 |
| `event.waitUntil` AI job 后台化 | classify-tags:41、suggest-merges:15、suggest-ratings:20 | 中：Node 版 Hono 无 executionCtx，要显式任务表/queue——恰好与 pg-boss 决策绑定 |
| SSE | stream.get.ts（sendStream + 手工帧） | 小：hono/streaming 有等价物，但该端点逻辑要随队列协议一起改 |
| cookie session + cache-control 中间件 + ssr-context | auth.ts、02-cache-control.ts、01-ssr-context.ts | 中：hono/cookie 可搬逻辑，但 96 行缓存策略中间件的语义要逐行重验 |
| **SSR 本身的归属** | 整个 Nuxt 前端 | **最大隐性成本**：前端 ~5,600 行 Vue/Nuxt 若要继续 SSR，仍需一个 Nitro（或等价 SSR server）存在——「API 换 Hono」实际是**多了一个服务**而非替换；部署从 4 容器变 5，与 plan 硬约束 4（容器数不显著增加）直接冲突 |
| auto-import 显式化 | 全 server | 本来就是收益项；B 强制完成（A 可选） |

### 8.4 工作量粗略量级（单人全职当量，含测试与双跑验证）

| 项 | 方案 A（同栈重架构） | 方案 B（Hono + pg-boss） |
|---|---|---|
| 巨型文件拆分 + 分层 | 3-5 天 | 同左（两方案共享） |
| auth/zod/枚举/配置 收敛 | 2-3 天 | 2-3 天 |
| 队列抽象 | 1-2 天（接口化 + 默认 Redis 实现） | 3-5 天（pg-boss 接入 + **Python sidecar 消费桥** + 结果回取协议迁移 + bot/SSE/extension 三方回归） |
| 框架层重建 | 0 | 4-6 天（§8.3 表：插件/scheduler/waitUntil/SSE/cookie/缓存中间件） |
| 前端处置 | 0（不动） | 3-8 天（保留 Nuxt 当纯前端层 = dev proxy + 部署改双进程；或换 SPA/框架 = 5,600 行重写） |
| 契约回归（53 端点 diff + 扩展 35 测试 + phash 抽样） | 2-3 天 | 3-4 天（变动面更大，双跑周期更长） |
| **合计量级** | **约 1.5-2.5 人周** | **约 3-5 人周**，且多一个常驻进程、多一类「双服务联调」故障面 |

### 8.5 审计结论（实证导向）

1. **当前代码的最大痛点 80% 是「组织问题」而非「框架问题」**：巨型文件、重复块、样板 auth、散落 SQL、死代码、命名错位——全部可在 Nitro 内解决，方案 A 性价比明确更高。
2. **Nitro 的真实约束集中在「后台任务与魔法」两点**（§8.2-1/2/3）。若 pg-boss 的核心诉求是「统一 job 模型 + 收编定时器」，**不换框架也能获得**：pg-boss 可以在 Nitro 插件里初始化（它就是 PG 表 + Node 轮询）——plan.md 把 pg-boss 绑在方案 B 里，其实是两个独立决策。
3. **方案 B 的隐性最大项不是 API 重写，而是「SSR 归属 + Python 队列桥」**（§8.3 末行、§3.5-1）。在「单机 4 容器」硬约束下，方案 B 要么破约束（+1 容器），要么让前端去 SSR 化——两者都超出「重构」范畴、进入「产品形态变更」。
4. **Redis 在本项目远不只是队列**（§3.5-3 的 8 类非队列用途），「容器 4→3」的收益被 plan.md 高估；即使 pg-boss 落地，Redis 大概率仍要留下（RediSearch 索引、限流、bot 状态、会话纪元）。
5. 建议决策路径：**方案 A + pg-boss 作为独立 ADR 评估 + RediSearch 三选一（§5 结论）**；把方案 B 降级为「仅当前端确定要脱离 Nuxt 时再议」。

---

## 附录 A：端点分组全清单（53 个，含鉴权方式）

| 分组 | 端点 | 鉴权 |
|---|---|---|
| posts (7) | GET /api/posts；GET/DELETE/PATCH /api/posts/:id；PUT /api/posts/:id/tags；GET /api/posts/random；GET /api/posts/by-source | GET 公开(anon 仅 safe)；PATCH=session 或 API key；DELETE/PUT=session |
| search (1) | GET /api/search | 公开（anon 仅 safe） |
| tags (3) | GET /api/tags；GET /api/tags/:name；GET /api/tags/autocomplete | 公开（anon 仅 safe 关联） |
| tasks (4) | POST /api/tasks；POST /api/tasks/web-import；GET /api/tasks/web-import/stream (SSE)；GET /api/tasks/:id | API key / session+ext key / session / API key+session |
| admin/ai (6) | POST chat、classify-tags、suggest-merges、suggest-ratings；GET jobs/:id、status | 全 session |
| admin/tags (8) | GET index；PATCH :id；POST merge、reprocess、fix-artist-categories；aliases GET/POST/DELETE | 全 session |
| admin/dashboard (2) | GET index；GET system-status | index=session 或 API key；status=session |
| admin/extension-keys (3) | GET/POST index；DELETE :id | 全 session |
| admin/settings (2) | GET/PUT /api/admin/settings | 全 session |
| auth (4) | POST login、logout、change-password；GET status | login 公开（Redis 锁定 5 次/5min→60s）；其余 session |
| settings (5) | GET/PUT /api/settings；GET public；POST test-pg、test-redis | public 公开（ETag）；其余 session |
| auto-rating-rules (3) | GET/POST index；DELETE :id | 全 session |
| rebuild (1) | POST /api/rebuild | API key 或 session |
| bot (1) | POST /bot/webhook | Telegram secret_token |
| 图片 (1) | GET /i/* | 公开（S3 透传） |
| 其他 (2) | GET /health；POST /logout | 公开 / 公开（清自身 cookie） |

## 附录 B：Redis key 全表（grep 实测）

| key | 类型/TTL | 读写方 |
|---|---|---|
| `kura:jobs` | list | 生产：web 6 点 LPUSH；消费：sidecar BRPOP |
| `kura:pending_results` | list | 生产：sidecar；消费：01-pipeline-worker BRPOP |
| `kura:results:{id}` | string, EX 3600→300 | sidecar 写 → worker 覆盖写 → 3 路消费读即删 |
| `kura:job_status:{id}` | string, EX 7200/300 | sidecar=processing；worker=done；bot/tasks 读 |
| `kura:job_meta:{id}` | string, EX 3600 | enqueueJob 写（force_rating）；worker 读 |
| `kura:ai_job:{id}` | string, EX 1800/60 | admin/ai 路由 + ai.ts 进度系统 |
| `kura:bot:lang:{chat}` / `kura:bot:autopass:{chat}` | string, 30d / 无 TTL | bot.ts 中间件与命令 |
| `kura:password_epoch` | string | auth.ts 改密失效 |
| `kura:ext_force_rating_audit` | list, LTRIM 1000 | web-import.post.ts 审计 |
| `rl:*` / `login:fail\|lock:*` / `apikey:rate:*` | string, EX | rate-limit.ts / login.post / patch+dashboard |
| `kura:tagidx` + `tag:{id}` | RediSearch + HASH | suggest.ts / 07-redis-index-sync |
