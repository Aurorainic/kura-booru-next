# Kura Booru Next — 全面代码审查汇总报告

**审查日期**: 2026-07-30
**审查范围**: 全部代码（server/、app/、extension/、sidecar/、infra/、根配置文件）
**审查方式**: 4 个并行审查分身，覆盖所有模块

---

## 统计总览

| 严重等级 | 数量 | 占比 |
|---------|------|------|
| 🔴 Critical | 14 | 14% |
| 🟠 High | 29 | 29% |
| 🟡 Medium | 37 | 37% |
| 🔵 Low | 21 | 21% |
| **总计** | **101** | |

| 模块 | Critical | High | Medium | Low |
|------|---------|------|--------|-----|
| Server 路由/中间件/平台 | 6 | 8 | 10 | 5 |
| Server 业务逻辑/Schema | 2 | 5 | 7 | 5 |
| 前端 App | 4 | 8 | 10 | 5 |
| 扩展/Sidecar/基础设施 | 2 | 8 | 10 | 6 |

---

## 🔴 Critical — 必须立即修复

### 1. `server/routes/bot/webhook.post.ts` — 违反统一错误契约
裸用 `defineEventHandler` + `createError`，错误格式与全站 `{ code, message }` 契约不兼容。影响 Telegram webhook 运维。
**修复**: 使用 `AppError` + 自定义 handler wrapper。

### 2. `server/routes/api/posts/[id].patch.ts` — 绕过 Zod 校验层
`readBody` + 手动验证替代 `schemas.body`，OpenAPI 元信息丢失，类型安全丧失。
**修复**: 传入 `z.object({ rating: zRating })` 作为 `schemas.body`。

### 3. `server/routes/api/admin/ai/providers/` — 非事务性 toggle 存在竞态
"disable-all-then-insert" 模式无事务保护，并发下可能出现多个 enabled provider 或零 provider。
**修复**: 包裹在 `db.transaction()` 中。

### 4. `server/routes/api/settings/index.put.ts` — 裸 select 可能泄露敏感列
PUT 路径直接返回 `db.select().from(settings)`，与 GET 路径的 `getSettings()` 投影不一致。
**修复**: PUT 也使用 `getSettings()`。

### 5. `server/routes/api/auth/logout.post.ts` — Cookie 删除缺少属性匹配
`deleteCookie` 仅传 `path`，未匹配 `Secure`、`HttpOnly`、`SameSite` 属性，可能导致登出无效。
**修复**: 导出统一的 `SESSION_COOKIE_OPTIONS` 常量，删除时复用。

### 6. `server/routes/i/[...].ts` — S3 代理路径无遍历防护
`event.path.replace()` 提取的 key 未过滤 `..` 和绝对路径，误配置时可导致 SSRF。
**修复**: 添加路径遍历过滤。

### 7. `server/lib/bot/bot.ts` — 大面积违反显式 import 规则
16 个符号依赖 Nitro auto-import（db、redis、searchPosts、isAiEnabled 等），分散在 7 个模块。任何 auto-import 断裂都导致 bot 静默失效。
**修复**: 添加所有必需显式 import。

### 8. `server/lib/import/pipeline.ts` — 隐式 import AI 函数
`isAiEnabled()` 和 `aiProcessTagsForPost()` 未显式 import。
**修复**: 添加显式 import。

### 9. `app/components/PostInfoPanel.vue` — `v-html` 渲染外部描述
`post.description` 通过 `v-html` 渲染，存在 XSS 注入风险。
**修复**: 改为纯文本渲染或前端 DOMPurify 过滤。

### 10. `app/pages/admin/import.vue` — 绕过 `fetchApi` 统一错误处理
直接使用 `$fetch` 而非 `fetchApi`，不走 `getBaseUrl()`、不统一处理 `ApiError`、不统一 SSR Cookie 转发。
**修复**: 通过 `fetchApi` 包装调用。

### 11. `infra/scripts/build.sh` — 完全过时的构建脚本
引用不存在的 `backend/`、`bot/`、`frontend/` 目录，镜像标签与 docker-compose.yml 不匹配。误用可导致部署事故。
**修复**: 删除或重写。

### 12. `Dockerfile` + `sidecar/Dockerfile` — 容器以 root 运行
两个 Dockerfile 均未设置 `USER` 指令，容器被攻破后攻击者获得完整 root 权限。
**修复**: 添加 `USER` 指令。

### 13. `sidecar/sidecar.py` — SSRF TOCTOU 竞争条件
DNS 解析验证后、实际连接前存在时间窗口，可被 DNS 重新绑定攻击利用。
**修复**: 在 socket 级别做 IP 验证。

### 14. `app/pages/login.vue` — 登录信息泄露
"登录成功但无管理员权限" 泄露了"密码正确"的信息，存在时序侧信道。
**修复**: 统一显示「登录失败」。

---

## 🟠 High — 优先修复

### Server 路由/中间件/平台

| # | 文件 | 问题 |
|---|------|------|
| H1 | `bot/webhook.post.ts` | `readBody` 非幂等，未来重构隐患 |
| H2 | `posts/[id]/tags.put.ts` | remove/add 无事务保护，并发下 postCount 可能不一致 |
| H3 | `contract/endpoints.ts` | 注释 53 端点与实际 59 不符 |
| H4 | `queue.ts` + `pipeline-worker.ts` | `while(true)` 无 graceful shutdown，hot-reload 产生僵尸进程 |
| H5 | `admin/settings/index.put.ts` | 无键白名单写入，无防御纵深 |
| H6 | `login.post.ts` | Redis 宕机时登录 500，与 fail-open 语义不一致 |
| H7 | `02-cache-control.ts` | 重复计算 `getIsAdmin`，每个请求多一次 Redis 读 |
| H8 | `admin/dashboard/index.get.ts` | `mvResult` 静默空数据无告警 |

### Server 业务逻辑/Schema

| # | 文件 | 问题 |
|---|------|------|
| H1 | 多个 `server/lib/*` 文件 | 使用 `~/types` 跨层类型导入，模糊层级边界 |
| H2 | `lib/ai/types.ts` × `app/types/index.ts` | `AiJobStatus` 的 `'gone'` 状态不一致 |
| H3 | `bot/bot.ts` | `/stats` handler 使用 auto-imported `postTags` |
| H4 | `import/pipeline.ts` | import 风格不一致（`../../schema` vs `../../schema/posts`） |
| H5 | `search/suggest.ts` | `suggestTags` 未使用 `clampPerPage` |

### 前端 App

| # | 文件 | 问题 |
|---|------|------|
| H1 | `PostsPanel.vue` | 分页仅显示 10 页，无法访问 11+ 页 |
| H2 | `Pagination.vue` | SSR 中 `useRequestURL()` 行为不一致 |
| H3 | `admin/index.vue` | `<KeepAlive>` 无 `max` 限制，8 面板全驻内存 |
| H4 | `DashboardPanel.vue` | KeepAlive 返回后数据过期，无刷新机制 |
| H5 | `AiAssistantPanel.vue` | 重复 `getAiStatus`，与 AdminStatusBar 冗余 |
| H6 | `SearchBar.vue` | `:value` + `@input` 而非 `v-model`，风格不统一 |
| H7 | `AnnouncementBanner.vue` | resize listener 未在 `onUnmounted` 移除 |
| H8 | `login.vue` | 见 Critical #14 |

### 扩展/Sidecar/基础设施

| # | 文件 | 问题 |
|---|------|------|
| H1 | `infra/scripts/build.sh` | 标签名与 docker-compose.yml 不匹配 |
| H2 | `sidecar/requirements.txt` | 缺少 `requests` 显式依赖声明 |
| H3 | `extension/manifest.json` | host_permissions 冗余 + phixiv.net 无 content_scripts 匹配 |
| H4 | `sidecar/sidecar.py` | SSRF 重定向保护无测试覆盖 |
| H5 | `infra/docker-compose.yml` | worker 缺少健康检查 |
| H6 | `sidecar/sidecar.py` | base64 图片直接存 Redis，大任务可能 OOM |
| H7 | `nuxt.config.ts` | `enableAiTagProcessing` 暴露到客户端 |
| H8 | `sidecar/sidecar.py` | 重定向补丁无测试覆盖 |

---

## 🟡 Medium — 计划修复

### 逻辑 Bug

| # | 文件 | 问题 |
|---|------|------|
| M5* | `server/lib/ai/assistant.ts` | `posts.aiTagStatus IS NULL` 永远返回 0（schema 有 `default('pending')`）→ "等待 AI 处理的帖子数"永远显示 0 |

### 代码质量

- `server/lib/import/pipeline.ts` — sharp 惰性 import 失败路径返回 null 继续
- `server/lib/import/steps/rating.ts` — `RATING_RANK` 硬编码与 schema 绑定
- `server/lib/ai/client.ts` — `Object.assign` 扩展 Error 对象，TypeScript 无法推断
- `server/lib/import/pipeline.ts` — page_count reconcile 失败仅 console.error
- `server/utils/settings.ts` — `getPublicSettings` 动态 import 模式
- `server/routes/api/auth/change-password.post.ts` — 冗余 cookie 解析
- `server/routes/api/tasks/web-import.post.ts` — `lpush` + `ltrim` 非原子 + `redis as any`
- `server/routes/api/tags/index.get.ts` — 混合 `event.context.params` 与 schema
- `server/routes/api/admin/tags/[id].patch.ts` — 重复硬编码分类枚举
- `server/routes/api/settings/test-*.post.ts` — 动态 import postgres/redis
- `server/plugins/01-pipeline-worker.ts` — retry 计数语义不一致
- `server/routes/api/settings/index.put.ts` — `body.settings` 无 Zod 校验
- `server/plugins/seed-admin.ts` — bcrypt 12 轮次无环境变量覆盖
- `server/plugins/02-bot-setup.ts` — webhook 注册失败静默吞掉
- `server/middleware/04-extension-auth.ts` — 无 API 版本兼容性检查

### 前端

- Props 定义模式不一致（三种混用）
- `defineAsyncComponent` 无 `name`，KeepAlive include/exclude 无法工作
- `PhotoCard.vue` hover 在移动端与 modal 冲突
- `DashboardPanel.vue` SVG 饼图无 ARIA
- `AiChatPanel.vue` 聊天历史存 localStorage 含敏感数据
- `ThemeToggle.vue` `onUnmounted` 嵌套在 `onMounted` 内
- `useConfirm.ts` `crypto.randomUUID` 检查不够健壮
- `useToast.ts` readonly 浅层代理可被深层变异
- `useSsrContext.ts` SSR 初始化顺序无保证
- `router.options.ts` `savedPosition` 未处理 hash 锚点

### 扩展/Sidecar/基础设施

- `sidecar/sidecar.py` — `downloaded` 引用检查不当
- `sidecar/sidecar.py` — `import requests` 顶层声明时机
- `extension/popup/popup.js` — API Key 前缀校验缺少测试
- `extension/content/content.js` — 错误消息可能被截断
- `extension/background/service-worker.js` — fetch 无超时
- `infra/scripts/migrate-db.sh` — 密码无法非交互传递
- `package.json`（根目录）— 缺少测试命令
- `sidecar/sidecar.py` — `Image.open()` 重复调用
- `.github/workflows/docker-publish.yml` — 缺少镜像安全扫描
- `drizzle.config.ts` — DATABASE_URL 未设置时错误信息不清晰

---

## 🔵 Low — 可选改进

- `server/utils/auth.ts` — `parseCookies` 不处理 quoted values
- `server/utils/extension-auth.ts` — base62 全零输入边界情况
- `server/lib/ai/client.ts` — `testAiConnection` 与 `callAi` 重试策略不一致
- `server/lib/pagination.ts` — ALLOWED 常量与前端步长不一致
- `server/lib/bot/bot.ts` — `postTags` auto-import 依赖
- `app/` — 多处 `as any` 类型断言
- `app/` — 魔法数字散落各处
- `app/components/ImageModal.vue` — 全局监听器清理兜底
- `app/` — CSS 变量缺少响应式规范
- `app/` — Vue 文件命名不一致
- `server/routes/health.get.ts` — 太简单，无依赖检查
- `server/routes/api/rebuild/index.post.ts` — PURGE fetch 无超时
- `server/middleware/00-security-headers.ts` — 缺少 HSTS
- `server/routes/api/auth/login.post.ts` — cookie 设置/删除属性不匹配
- `server/routes/` — 多处 `as any`
- `extension/manifest.json` — host_permissions 冗余
- `sidecar/sidecar.py` — BLOCKED_NETWORKS 127.0.0.0/8 范围过宽
- `extension/content/content.css` — CSS 动画重触发需注释说明
- `infra/scripts/validate-env.sh` — `source` 加载 .env 不安全
- `sidecar/` — 缺少 `.dockerignore`
- `extension/tsconfig.json` — vitest 4 ESM 兼容性

---

## CLAUDE.md 约束合规性总结

| 约束 | 状态 | 说明 |
|------|------|------|
| Handler wrappers | ⚠️ 部分合规 | bot/webhook、i/[...]、logout、health 裸用 |
| AppError 替代 createError | ⚠️ 部分合规 | bot/webhook.post.ts 3 处 createError |
| Contract freeze | ✅ 已覆盖 | 注释数字过时（53→59） |
| Cache-Control 规则 | ✅ 合规 | 实现正确 |
| getIsAdmin Redis fail-open | ✅ 合规 | 正确实现 |
| /api/settings/public 白名单 | ✅ 合规 | 严格白名单 |
| Maintenance mode 302 | ✅ 合规 | 正确实现 |
| v0.9.0 显式 import | ⚠️ 部分合规 | bot.ts、pipeline.ts 违规 |
| 禁用 `~/server/utils/` | ✅ 合规 | 全部使用相对路径 |
| Redis top-level await | ✅ 合规 | getRedis() proxy pattern |
| Cookie deletion 匹配属性 | 🔴 违规 | logout.post.ts 仅传 path |
| Logout 服务端 redirect | ✅ 合规 | 正确实现 |
| phash 不暴露 | ✅ 合规 | 正确 strip |
| Pagination 20/40/100 | ✅ 合规 | 正确实现 |
| Anon safe only / non-safe 404 | ✅ 合规 | 正确实现 |
| Extension ES5 | ✅ 合规 | 严格遵循 |
| gallery-dl library mode | ✅ 合规 | DownloadJob API + ThreadPoolExecutor |
| S3 通用抽象 | ✅ 合规 | 无 provider-specific 代码 |
| PG 18+ volume mount | ✅ 合规 | /var/lib/postgresql |
| Docker NODE_ENV=production | ✅ 合规 | 双重保障 |
| Toast + Confirm | ✅ 合规 | 无 alert/confirm |
| AdminStatusBar 共享轮询 | ⚠️ 部分合规 | AiAssistantPanel 冗余请求 |
| KeepAlive 包裹 admin panels | ⚠️ 部分合规 | 无 max 限制 |

---

## 优先修复路线图

### 第一优先级（安全 + 正确性）
1. **C7/C8** — bot.ts + pipeline.ts 显式 import（防止静默失效）
2. **C9** — PostInfoPanel v-html XSS
3. **C14** — 登录信息泄露
4. **M5** — aiTagStatus IS NULL 逻辑 bug
5. **C3** — Provider toggle 事务
6. **C5** — Cookie 删除属性匹配

### 第二优先级（稳定性 + 性能）
7. **C12** — Docker root 用户
8. **C13** — SSRF TOCTOU
9. **C11** — 删除过时 build.sh
10. **H4** — Worker graceful shutdown
11. **H6** — Sidecar base64 → Redis OOM
12. **H3** — KeepAlive max 限制

### 第三优先级（代码质量）
13. **C2** — Zod 校验层统一
14. **H2** — posts/[id]/tags.put.ts 事务
15. **H7** — 缓存控制中间件重复计算
16. **H1** — Admin 分页 11+ 页
17. **H4** — Dashboard 数据过期刷新

---

*报告生成时间: 2026-07-30 19:38 UTC+8*
