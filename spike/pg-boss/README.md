# spike/pg-boss — pg-boss 可行性验证（plan.md §B4）

验证 v0.9.0 队列选型的三个决策输入。结论已写入 `docs/adr/adr-0001-queue.md`。

## 复现

```bash
cd spike/pg-boss
docker compose up -d --wait   # 一次性 Postgres 16（无 volume，数据随容器销毁）
npm install                   # pg-boss ^12
node demo.mjs                 # 约 2.5 分钟（cron 演示等待 2 次分钟级触发）
docker compose down           # 清理
```

## 验证项与结论（pg-boss 12.26.1，schema v37）

| 验证项 | 结果 |
|---|---|
| ① 入队/消费（SKIP LOCKED） | PASS — 3 个并发 worker 消费 12 个 job，0 重复（4/4/4 分布）。`FOR UPDATE SKIP LOCKED` 实现见 `node_modules/pg-boss/dist/plans.js:1156` |
| ② 定时任务 | PASS — `boss.schedule()` cron 注册并周期触发。dashboard-refresh（产线 `*/5 * * * *`）与 sync-tasks（产线 `0 * * * *`）等价物均注册成功 |
| ③ 失败重试 + 死信 | PASS — `retryLimit:2 + retryDelay:1s + retryBackoff` → 共 3 次尝试后进 `deadLetter` 队列；`boss.redrive()` 可将死信重新投回原队列 |
## 实施时注意（demo 中踩到的）

- **worker 回调签名**：v12 默认批量形态 `async ([job]) => {...}`，不是 `async (job) =>`。
- **DLQ 必须先建**：`createQueue(name, { deadLetter })` 要求死信队列已存在，否则 `Queue X does not exist`。
- **cron 有 60s singleton 下限**：timekeeper 对定时发送使用 `singletonSeconds: 60`（`dist/timekeeper.js`），次分钟级调度会被钳到 ~1 次/分钟。对 5min/1h 的产线节奏无影响。
- **cron 监控 tick 默认 30s**（`cronMonitorIntervalSeconds`，可调 1–45）：定时任务的首次触发可能滞后一个 tick。
- **死信是"复制"不是"移动"**：进 DLQ 的是一条**新 id** 的 job（payload 原样保留），原 job 以 `failed` 状态留在原队列。关联死信与原任务要在 data 里带业务 id，不能靠 job id。
- **`boss.fetch()` 会锁定 job**（置为 active）：断言队列内容用 `findJobs()`，不要用 fetch 窥探。

## 明确未验证（spike 边界）

- Python sidecar 消费 pg-boss —— 结论已知不可行（pg-boss 是 Node-only），`kura:jobs` → sidecar 的 Redis 桥保持不动（backend-audit §3.5-1）。
- Nitro 插件内初始化 —— 不在本 spike 范围（硬约束不改 server/）；pg-boss 初始化无框架耦合，`boss.start()` 可在任意 Nitro 插件注册时调用。
