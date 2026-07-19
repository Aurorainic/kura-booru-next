# ADR-0001: 队列选型 —— JobQueue 接口先行 + pg-boss 收编 Node 侧 job

- 状态：已接受（2026-07-19）
- 关联：plan.md §B3 / §B4；spike：`spike/pg-boss/`（7/7 PASS）
- 决策输入：`docs/backend-audit-v0.9.0.md` §3（队列与异步现状）、§3.5（迁移面）、§8.2-2（Nitro 无后台任务抽象）

## 背景

现状不是"一个队列"，而是跨两语言三进程的 4-key 状态机（backend-audit §3.1）：
`kura:jobs`（web LPUSH → Python sidecar BRPOP，`sidecar.py:387`）→ `kura:results:{id}` + `kura:pending_results`（`sidecar.py:369-374`）→ pipeline-worker BRPOP（`plugins/01-pipeline-worker.ts:23`）→ 覆盖写结果 + `kura:job_status:{id}=done`。

审计确认的四个真实痛点：

1. **无重试无 DLQ**：`handleJobWithRetry`（`queue.ts:106-113`，MAX_RETRIES=3 + 指数退避）是全仓零调用的死代码（§3.1、§8.1-3）。pipeline 失败永不写回终态，调用方只能等 300s 轮询超时（§3.1）。
2. **AI job 不持久**：3 个 admin/ai 路由靠 `event.waitUntil` fire-and-forget 续命（`classify-tags.post.ts:41`、`suggest-merges.post.ts:15`、`suggest-ratings.post.ts:20`），进程重启即丢（§3.2）。
3. **定时器是杂牌军**：2 个 setInterval（`06-dashboard-refresh.ts` 5min、`03-sync-tasks.ts` 1h）+ 1 个无限 BRPOP + 5 个启动/关闭钩子，无统一抽象（§3.4）；Nitro 没有 cron/worker 概念，属框架留白（§8.2-2）。
4. **全面替换有硬边界**：pg-boss/BullMQ 均为 Node-only，Python sidecar 无法消费（§3.5-1）；结果回取协议（TTL 语义 + `in_progress` 等状态字面量，`tasks/[id].get.ts:14-22`）有 bot / extension / SSE 三方外部消费（§3.5-2）；Redis 另有 8 类非队列用途（§3.5-3）。

## 选项

| 选项 | 内容 | 评估 |
|---|---|---|
| A. 仅接口抽象 | 定义 `JobQueue` 接口（enqueue/getStatus/consume/retry），默认实现仍 Redis | 成本最低（生产者仅 6 个调用点、queue.ts 仅 114 行，§8.1-3），但重试/DLQ/定时器统一仍要自己造 |
| B. pg-boss 收编 Node 侧 | 接口先行 + pg-boss 作为第二实现，收编 AI job、2 个 setInterval、后续 Node 内部任务；sidecar 桥保持 Redis | spike 验证全部通过；不重造重试/DLQ/cron；零新增容器（pg-boss 住在现有 PG） |
| C. 全收编 | 连 sidecar 桥与结果回取协议一起迁 pg-boss | 不可行：sidecar 消费不了（§3.5-1）；结果协议有 3 个外部消费方，契约风险高（§3.5-2）；Redis 仍删不掉（§3.5-3），收益不抵迁移面 |

## spike 结论（pg-boss 12.26.1，PG 16）

`spike/pg-boss/demo.mjs` 实测 7/7 PASS：

- **入队/消费**：3 并发 worker 消费 12 job，0 重复（4/4/4 均匀分布）——`FOR UPDATE SKIP LOCKED` 语义成立（实现见 `pg-boss/dist/plans.js:1156`）。
- **定时任务**：`boss.schedule()` cron 注册 + 周期触发实测通过，dashboard-refresh（`*/5 * * * *`）与 sync-tasks（`0 * * * *`）等价物均可用。注意 cron 有 60s singleton 下限，对分钟级以上节奏无影响。
- **重试 + 死信**：`retryLimit:2 + retryBackoff` → 3 次尝试后进死信队列，`boss.redrive()` 可回投——正是现状缺失的能力（痛点 1）。

实施注意（详见 `spike/pg-boss/README.md`）：v12 worker 回调是批量签名 `async ([job]) =>`；DLQ 需先建；死信是**复制**（新 id、payload 保留、原 job 留 `failed`），关联要靠 data 里的业务 id。

## 决策

**选 B：JobQueue 接口先行 + pg-boss 收编 Node 侧 job。**

1. `server/platform/queue.ts` 定义 `JobQueue` 接口；默认 Redis 实现包装现有 `queue.ts` 语义，行为不变（承接 plan §B3）。
2. pg-boss 实现收编三类 Node 侧 job：
   - **AI job**：替代 `event.waitUntil` + `kura:ai_job:{id}`（§3.2），进度经 job 状态写回，重启不丢；
   - **dashboard-refresh-5min / sync-tasks-1h**：从 setInterval 迁到 `boss.schedule()`；
   - 后续 Node 内部任务（含重试 + DLQ，落实 plan §B3 的功能缺口）。
3. **明确不动**：`kura:jobs` → sidecar 的 Redis 桥（§3.5-1）；`kura:results:` / `kura:job_status:` 结果回取协议及其 TTL/字面量语义（§3.5-2，bot/extension/SSE 三方外部契约）；pipeline-worker 对 `kura:pending_results` 的 BRPOP。
4. 全部命名任务在 `server/platform/jobs.ts` 单点注册（承接 plan §B3 的 8 插件收编）。

## 后果

- **正面**：重试 + DLQ 从死代码变成平台能力；AI job 持久化；定时器统一进 cron 模型；pg-boss 住在现有 PG，**容器数不变**（4 个），符合硬约束 4；接口先行意味着 pg-boss 若不合用可回退 Redis 实现，切换成本已付过。
- **负面**：Redis（桥 + 8 类用途）与 pg-boss（Node 侧 job）两套机制并存，需靠 `platform/jobs.ts` 单点注册防散布；PG 增加 pgboss schema 若干表；cron 60s 粒度下限排除次分钟级调度（本项目无此需求）。
- **不做**：BullMQ 不引入（与现有 Redis 队列同源，不解决痛点 1/2/3 之外的任何问题，却要重写消费端）；sidecar 桥迁 HTTP 回调不评估（架构变化最大，§3.5-1，超 feature parity）。
