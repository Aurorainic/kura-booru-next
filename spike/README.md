# spike/ — 阶段 0 技术验证（plan.md §阶段 0）

两个 spike 的代码与结论，结论已落入 `docs/adr/`：

| 目录 | 验证对象 | 结论 | ADR |
|---|---|---|---|
| `pg-boss/` | pg-boss 队列（入队/SKIP LOCKED、cron、重试+DLQ） | 7/7 PASS | `docs/adr/adr-0001-queue.md` |
| `imgproxy/` | imgproxy 缩略图（S3 源、防 SSRF、签名多档宽度） | 10/10 PASS | `docs/adr/adr-0003-thumbnails.md` |

各目录 README 有复现命令。两个 spike 均为一次性环境（无 volume、独立 compose project），
`docker compose down` 后无残留；不影响 `server/`、`app/`、`sidecar/` 任何现有代码。
