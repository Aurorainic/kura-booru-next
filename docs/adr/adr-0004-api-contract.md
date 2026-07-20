# ADR-0004: API 契约约定 —— zod 全量校验 + 统一错误形状 + handler 包装 + 轻量 OpenAPI 生成

- 状态：已接受（2026-07-19）
- 关联：v0.9.0 规划文档 §B2 / §B5 / §F4（已随仓库清理移除，见 git 历史）
- 决策输入：backend-audit §6（不可变契约面）、§7.1（错误处理）、§7.2（输入校验）、§7.3（auth 样板）；frontend-audit §5.1（api.ts 手写端点层）（审计文档已随仓库清理移除，见 git 历史；结论见本文）

## 背景

审计确认的四个事实：

1. **零 zod**：`package.json` 无 zod（grep 全仓 0 命中），53 端点全部 `readBody<{...}>` + 手写校验（§7.2）。枚举值硬编码重复 ≥4 处且漂移不报错：`web-import.post.ts:5`（VALID_RATINGS）、`posts/[id].patch.ts:24-26`、`admin/tags/[id].patch.ts:30-32`（注释自承 "mirrors the enum"）、`pipeline.ts:59` 与 `pipeline.ts:273`（VALID_SOURCES 重复两次）。
2. **103 处 `createError` 无统一形状**（§7.1）：没有 `code` 字段，前端只能字符串匹配 `statusMessage`；扩展依赖的字面错误码（如 `key_not_authorized_for_force_rating`，`web-import.post.ts:73`）散落在各路由。utils 层还有两种错误方言（`Object.assign(new Error, {statusCode})` vs 裸 Error + 自制 code，§7.1）。
3. **auth 样板 ×40**：`getIsAdmin` 全仓 48 次调用，其中 ~40 次是路由里逐字重复的三行样板；BACKEND_API_KEY 的「30/min/IP 限流 + console.warn 审计」块在 `posts/[id].patch.ts:32-41` 与 `dashboard/index.get.ts:16-25` 逐字重复（§7.3）。
4. **契约下游价值**：前端 `composables/api.ts` 有 ~30 个手写端点函数（frontend-audit §5.1），OpenAPI 契约冻结后可由 openapi-typescript 生成类型取代（plan §F4）。

不可变契约面（§6，重构中不得改变行为）：扩展 2 端点（`web-import.post.ts`、`tasks/[id].get.ts` 及其状态字面量 `queued/in_progress/complete/duplicate/too_large/failed`）、Telegram webhook（secret_token + callback_data 协议）、`/i/` 反代、`kb_ext_` 前缀认证。

## 决策

### 1. zod 全量校验

引入 zod@4，53 端点全量定义入参（body/query/params）+ 出参 schema。枚举单点定义：`platform/schemas/enums.ts` 从 Drizzle enum（`server/schema/enums.ts:3-5`）派生 zod enum，消灭 §7.2 的 4 处硬编码。schema 集中放在 `modules/<domain>/schemas.ts`，路由只引用不内联。

### 2. 统一错误形状

```json
{ "code": "SNAKE_CASE_STABLE_CODE", "message": "人类可读", "details": {} }
```

- `code` 为稳定机器可读字符串，是前端/扩展/bot 的唯一匹配依据；`message` 自由文本不作为契约；`details` 可选（校验错误的 field errors 等）。
- HTTP statusCode 与 code 的映射在包装层统一处理；utils 层两种错误方言（§7.1）收敛为 `platform/errors.ts` 的 `AppError(code, status, message?, details?)`。
- **既有字面量保留**：`key_not_authorized_for_force_rating` 等扩展依赖的错误码原样成为 code 值（`web-import.post.ts:73`，§6）；任务状态字面量（`tasks/[id].get.ts:14-22`）不动。这些进契约测试白名单。

### 3. handler 包装

`platform/http/` 提供三个包装，消灭 §7.3 的样板：

- `defineAdminHandler({ schemas, handler })`：cookie session 三行样板 ×40 内收；
- `defineApiKeyHandler({ schemas, handler })`：BACKEND_API_KEY 校验 + 限流审计块 ×2 内收（`posts/[id].patch.ts:32-41` ≈ `dashboard/index.get.ts:16-25`）；
- `defineExtHandler({ schemas, handler })`：extension key（`requireAdminOrExtensionKey` 联合判别）+ per-key 60/min 限流（`web-import.post.ts:12-19`）。

包装层统一做：zod 校验（失败 → `VALIDATION_FAILED` + details）、`AppError` 兜底序列化、审计日志。每个包装在注册时把 `path + method + schemas + auth 方式` 写入路由注册表——这是 OpenAPI 生成的唯一数据源。

### 4. OpenAPI 生成：zod-to-openapi 轻量方案

评估结论：Nitro 没有 hono-openapi 那样的深度集成（Hono 已在 plan 阶段否决存档），采用 **`@asteasolutions/zod-to-openapi`@9 轻量生成**：

- `platform/openapi.ts` 从 handler 注册表（决策 3 的副产品）+ zod schema 生成 OpenAPI 3.1 文档；构建期产出 `openapi.json` 工件，同时在 admin 下暴露只读端点便于查看。
- 不可变契约（§6 四项）在文档中标注 `x-contract: frozen`，契约测试以其为基准录制 v0.8.1 响应做 diff（plan 验证策略）。
- 下游：`openapi-typescript`@7 生成 TS 类型，前端 `api.ts` 的 ~30 个手写端点函数改为类型安全薄封装（plan §F4）。
- 不引入完整 OpenAPI 框架/中间件栈：53 个薄路由 + 单一注册表，轻量生成足够，避免为文档能力背运行时依赖。

## 后果

- **正面**：53 端点契约显式化并机器可读；枚举漂移从"静默放行"变为编译期可见；错误匹配从字符串比较升级为稳定 code；auth 样板 ×40 + 限流块 ×2 消除；前端类型生成打通（§F4）。
- **负面**：逐端点补 schema 是纯体力活（plan §B2 已预估）；zod@4 + zod-to-openapi 两个新运行时依赖（server 侧，不进前端 bundle）；出参 schema 需要与 v0.8.1 实况逐端点对齐，以 diff 录制为准而非凭记忆编写。
- **边界**：SSR 页面路由（`/logout` 等非 `/api` 端点）只入文档不入 zod 出参校验；`/i/` 反代只登记契约不做 body 校验（流式透传，ADR-0003 保持不动）。
