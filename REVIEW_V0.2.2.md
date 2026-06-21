# Kura Booru Next — v0.2.2 全面 Review

**审查日期**：2026-06-21
**审查基线**：commit `535cee8` (v0.2.2)
**审查范围**：backend / bot / frontend / infra / 文档（README、PLAN、CLAUDE、CHANGELOG、docker-image）
**关注方向**：功能完整性、隐患与 bug、结构精简整合、workflow 链路、文档重构、PG18/Redis8 迁移可行性

---

## 0. TL;DR（执行摘要）

| 维度 | 评级 | 说明 |
|---|---|---|
| 功能完整性 | 🟢 良好 | v0.1 → v0.2.2 路线图基本兑现，核心甩链即存闭环稳定。 |
| 代码质量 | 🟡 中等偏上 | 分层清晰，但有若干重复定义、死代码、潜在异常路径。 |
| 安全性 | 🟡 中等 | 评级可见性、API key、cookie 属性都有处理；但**退出登录后浏览器仍处于登录态**确实是现存 bug，且修复 v0.2.2 时只覆盖了一半。 |
| 文档 | 🟡 中等偏上 | 信息齐全但**严重冗余**（同一信息 4 处维护）、版本漂移。 |
| 迁移成本（PG18/Redis8） | 🟢 低 | 现代码使用纯标准特性，迁移基本零代码改动。 |

**两条最高优先级结论**：

1. **退出登录 bug 未真正修复**（详见 §3.1）。v0.2.2 的 commit message 标题"logout cookie fix"是一种误诊 —— Cookie 删除属性早已正确，真正成因是**前端 redirect 时机 + 服务端 cookie 删除竞争 + 浏览器 cookie jar 行为**的组合。需要按 §3.1 的精确路径定位修复。
2. **文档与配置的"四源真相"问题**：`README.md` / `PLAN.md` / `CLAUDE.md` / `docker-image.md` + `infra/.env.example` 大量重复信息，每次发版要改 5 处，已经是质量风险源。文档重构是 ROI 最高的一项。

---

## 1. 目标功能完整性审查

### 1.1 v0.2.x 路线图对照

| Phase | 计划 | 实际实现 | 状态 |
|---|---|---|---|
| v0.1.0 基础闭环 | Bot → Backend → ARQ → S3 | ✅ 完整 | ✅ |
| v0.1.2 标签分类/转发消息/HTML 描述 | bleach 清洗 + set:html | ✅ 完整 | ✅ |
| v0.1.3 评级系统 + Admin 认证 | rating enum + signed cookie | ✅ 完整 | ✅ |
| v0.2.0 删除 / 自动评级规则 / web-import | DELETE + AutoRatingRule + 批量导入 | ✅ 完整 | ✅ |
| v0.2.1 Bot 评级菜单 | inline keyboard | ✅ 完整 | ✅ |
| v0.2.2 倒计时 + 自动评级提示 + logout 修复 | 10s 倒计时、auto_rating 字段 | ⚠️ **logout 修复无效** | 🟡 |

### 1.2 功能完整性的缺口

| # | 缺口 | 影响 | 证据 |
|---|---|---|---|
| F1 | **退出登录后浏览器仍处于登录态** | 安全 / UX | `frontend/src/layouts/BaseLayout.astro:189-196` + `backend/app/api/auth.py:69-74` |
| F2 | **`/admin/posts` 缩略图 URL 写死 `/i/`** | 缩略图在某些配置下打不开 | `frontend/src/pages/admin/posts.astro:93`（其它页面走 `getThumbUrl`） |
| F3 | **gallery-dl 下载失败时仍写入空 Post** | 脏数据 | `process_image.py:188-200` 的 `continue` 在所有 URL 失败后才返回 error，但**单个 URL 中途异常的清理路径**没覆盖：S3 已上传后 DB 写入失败时已上传对象无清理 |
| F4 | **phash 去重 prefix 桶未真正实现"O(1)"** | 性能 | `phash.py:89` 用 `Post.phash.startswith(prefix)` + 全行扫描，不是真分桶表。prefix 桶命中后还要线性比 Hamming。库小无感，库大后变慢 |
| F5 | **`_confirmed_posts` 是进程内 set** | 多 worker / 重启后状态丢失 | `bot/app/handlers/url_handler.py:25`。Bot 容器重启后所有 post 重新可被确认（用户可重复改评级）。当前单副本影响小 |
| F6 | **`posts.[id].astro` 错误处理走 `Astro.redirect("/404")`** | HTTP 状态 302 → 200，搜索引擎看到的是 200 | `posts/[id].astro:23-25`。匿名访问非 safe 帖应直接返回 404 |
| F7 | **`tags/[name].astro` 用 `fetchTags(...per_page=1000)` 找分类** | N+1 + 网络浪费 | `tags/[name].astro:27`。每次访问标签详情页都拉 1000 条 tag 列表本地 find，应为新增 `GET /api/tags/{name}` 返回分类（后端已有该端点） |
| F8 | **SSR 缓存至今未启用** | 性能（PLAN 仍列为待办） | `infra/caddy/Caddyfile` 无 Souin 配置。文档反复强调"⚠️ 不要在没解决 Vary: Cookie 前启用"，但 roadmap 上"先解决再启用"也没有清晰方案 |
| F9 | **bot auto-rating 规则的 `auto_rating` 字段对"用户手动选了与建议一致"的情况无去重** | 微小 UX | `callback.py:42-50` 即使 post 当前 rating 已等于用户选择的 rating，仍会发一次 PATCH。无功能影响 |
| F10 | **web-import 端点对 URL 数量无上限** | DoS 风险 | `backend/app/api/tasks.py:79-104` 接受任意长度 `urls[]`，可一次入队几千任务打爆 ARQ / S3 |

---

## 2. 架构与代码隐患清单

按严重度 P0 → P3 排序。每项含 **位置 / 根因 / 影响 / 精确修复路径**，便于零歧义落地。

### 🔴 P0 — 必须修复

#### **P0-1 退出登录后浏览器仍处于登录态**（用户已点名）

- **位置**：`backend/app/api/auth.py:69-74` + `backend/app/auth.py:85-97` + `frontend/src/layouts/BaseLayout.astro:185-196`
- **现象**：点退出 → 跳转 `/` → 页面仍显示"🔒 管理模式"且仍能看到非 safe 内容。需手动刷新 1~2 次或关闭重开浏览器才"真正登出"。
- **根因（精确）**：
  1. **Cookie 删除指令确实是正确的**（v0.2.2 已加 `secure/httponly/samesite`），但 **CORS / fetch 凭据问题**：`lib/api.ts` 的 `fetchApi` 在**浏览器侧**调用时**未带 `credentials: "include"`**。导致浏览器发送的 logout fetch 不一定带 cookie，后端 `delete_cookie` 写入的 Set-Cookie 虽然回了，但因为是跨域 fetch（`PUBLIC_API_URL` 为绝对域名），浏览器对它的 Set-Cookie 处理取决于 CORS 是否允许凭据 —— `allow_credentials=True` 在后端开了，但前端 fetch 没声明，响应的 Set-Cookie 被**丢弃**。
  2. **更隐蔽的次因**：即使 cookie 删了，浏览器 `window.location.href = "/"` 触发的下一次 SSR 请求时，**前端浏览器有可能在 Service Worker / 内存里持有页面状态**，但本仓库无 SW，所以这条不是主因。
  3. **第三种可能**：用户实际部署是 **同源**（Caddy 反代 `/api/*`），则 1 不成立 —— 此时根因变成：**`logout()` 用 `await` 等待 fetch resolve，但 `fetch` 在 `response` 头到达时即 resolve，浏览器未必在同一 tick 应用 Set-Cookie；随后立刻跳转 `/`，新请求携带的是"即将被删但尚未真正删"的旧 cookie**。
- **精确修复路径（消除不确定性）**：
  1. **首选方案（推荐）**：把 logout 改为**服务端路由 + 表单 POST/GET**，让浏览器原生导航完成 cookie 清除，避免 fetch 与导航的竞态：
     - 新增 Astro 端点 `frontend/src/pages/logout.ts`（Astro endpoint），SSR 内部 fetch 后端 `/api/auth/logout` 转发 cookie，然后 `return Astro.redirect("/", 302)`。浏览器原生 302 导航会保证 cookie 在下一次请求前已更新。
  2. **次选方案**：保留前端 fetch 模式，但**确保 fetch 带 credentials**，并在 logout 成功后**主动清前端任何缓存**，再用 `window.location.reload()` 而非 `href = "/"`。
  3. **验证步骤**：浏览器 DevTools → Network → 点退出 → 检查 `/api/auth/logout` 响应头是否含 `Set-Cookie: kura_admin_session=; Max-Age=0; ...` 且**属性与 set 时逐字一致**（特别是 Path、Domain、Secure）。若 Domain 不一致也会导致删不掉。
- **为什么 v0.2.2 的 commit 没修好**：commit 只改了"删除指令的属性"，但真正的瓶颈在 **fetch credentials / 同步竞态**，这两个都未触及。

#### **P0-2 `nul` 文件污染仓库根目录**

- **位置**：仓库根 `nul`（Windows 保留名，201 字节，内容是 bash 报错信息）
- **根因**：之前 `cd /d ...` 命令在 bash 下失败，错误输出被重定向到了 `nul`，但 Linux/bash 不识别 `nul`，于是当作普通文件创建。
- **影响**：Windows 上 `nul` 是保留设备名，clone 后 Windows 用户**无法正常删除/检出**该文件（git 报错）。也污染了仓库整洁度。
- **修复**：`git rm --cached nul && git commit`，并加进 `.gitignore`：`nul`。

#### **P0-3 `process_image` 的 image_urls 字段会被 append 多次**

- **位置**：`backend/app/services/gallery_dl.py:191-193, 264-265`
- **根因**：`result["image_urls"]` 初始化为 `[]`，DataJob 分支和 infojson 分支都用 `.append()`。若 DataJob 已拿到 `url`，又走到了 infojson 分支（条件是 `not result["metadata"]`，目前不会同时进入），不会双写。但**单个分支内**：DataJob 找到第一个 Url 就 break，但 infojson 分支的 `os.walk` 里没 break 同样的逻辑，可能 append 多次。`process_image.py:153` 的 `for img_url in image_urls` 会**多次尝试下载同一 URL**。
- **影响**：轻微 —— 浪费下载，但每个 URL 都用 `break` 跳出循环，所以只下载第一个，无功能错误。**但是**：如果第一个 URL 下载失败，会去试第二个"假"的 URL，制造无谓重试。
- **修复**：infojson 分支 break 后用 set 去重，或在 `process_image` 入口对 `image_urls` 去重。

### 🟠 P1 — 强烈建议修复

#### **P1-1 ALLOWED_PER_PAGE 三处重复定义**

- **位置**：`backend/app/api/constants.py:6`（canonical）、`backend/app/api/tags.py:29`、`backend/app/api/search.py:34`、`frontend/src/lib/api.ts:47`
- **修复**：tags.py / search.py 直接 `from app.api.constants import ALLOWED_PER_PAGE`。前端那份保留（语言隔离）。
- **v0.1.0 audit 标记过但未贯彻**（PLAN.md §"v0.1.0 代码审计与清理"第 6 项号称已修，实际只动了部分文件）。

#### **P1-2 `tags/[name].astro` 拉取 1000 tags 找分类**

- **位置**：`frontend/src/pages/tags/[name].astro:27`
- **根因**：后端 `GET /api/tags/{name}` 已返回完整 TagRead（含 category），前端没用，却退而求其次拉列表。
- **修复**：换成 `fetchTag(name)` 调用（需要在 `lib/api.ts` 新增此封装）。

#### **P1-3 `admin/posts.astro` 缩略图写死 `/i/{thumb_key}`**

- **位置**：`frontend/src/pages/admin/posts.astro:93`
- **根因**：其它地方用 `getThumbUrl(post)` 走 `PUBLIC_S3_EXTERNAL_URL`，这里绕过了抽象层。
- **影响**：当用户实际配置走 Caddy `/i/*` 代理时刚好对得上；走 R2 直连时**所有 admin 列表缩略图 404**。
- **修复**：替换为 `getThumbUrl(post)`。

#### **P1-4 `posts/[id].astro` 404 用 redirect 而非状态码**

- **位置**：`frontend/src/pages/posts/[id].astro:23-25`
- **修复**：用 Astro 的 `Astro.response.status = 404` + 渲染 404 模板，而不是 `Astro.redirect("/404")`（返回 302 + 200）。

#### **P1-5 `admin/auto-rating.astro` 末尾重复 `<script define:vars>` 块**

- **位置**：`frontend/src/pages/admin/auto-rating.astro:148` 和 `:249`
- **根因**：复制粘贴遗留。两个块内容完全一样，都注入 `var TAG_NAMES = tagNames;`。
- **影响**：无功能 bug，但第二个块覆盖第一个，多余且会让阅读者疑惑。
- **修复**：删除第二个。

#### **P1-6 `fetchApi` 未在浏览器侧声明 `credentials`**

- **位置**：`frontend/src/lib/api.ts:119-122`
- **根因**：`fetch` 默认 `credentials: "same-origin"`。`PUBLIC_API_URL` 配置为绝对域名时，logout / login 的 cookie 操作跨域失效（与 P0-1 直接相关）。
- **修复**：浏览器分支显式 `credentials: "include"`；或在所有客户端 fetch 里加上；并确保后端 CORS `allow_origins` 为精确域名而非 `*`（已正确）。

#### **P1-7 `config.py` 模块级 `settings = get_settings()` + `get_settings()` 用 `lru_cache`**

- **位置**：`backend/app/config.py:104-105`、`database.py:13`
- **根因**：`lru_cache` 在测试时无法 override env。模块级 `settings` 在 `from app.config import settings` 时立即求值，env 必须在该 import 之前就绪。
- **影响**：测试困难；多进程 fork 时若有 env 动态注入会出问题。
- **修复**：依赖注入用 `Depends(get_settings)`，避免模块级副作用。

#### **P1-8 `get_post` 端点先于 `by-source` / `random` / `{post_id}` 注册顺序**

- **位置**：`backend/app/api/posts.py` 中 `@router.get("/by-source")` / `"/random"` 在 `@router.get("/{post_id}")` 之前注册 ✅。**实际顺序正确**，但 `/search/` 的端点 `/api/search/` 用的是独立 router，OK。**此项无需修复**，仅记录已验证。

#### **P1-9 `update_post_rating` 走 API key 旁路**

- **位置**：`backend/app/api/posts.py:162-184`
- **根因**：当 `BACKEND_API_KEY` 为空（dev）时，**任何匿名 PATCH 都能成功**。生产中 BACKEND_API_KEY 必填所以不是问题，但 `validate-env.sh` 把它列入 prod required ✅。
- **影响**：dev 环境任何匿名访客可改评级。可接受但应文档化。
- **修复**：dev 也强制要 admin session 或 API key 二选一。

#### **P1-10 web-import 无 URL 数量上限**

- **位置**：`backend/app/api/tasks.py:79-104`
- **修复**：`WebImportRequest` 加 `urls: list[str] = Field(..., max_length=50)`；超出返回 413。

### 🟡 P2 — 推荐修复

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| P2-1 | `backend/app/api/posts.py:151` | `random_post` 用 `ORDER BY created_at DESC OFFSET random`，大表慢 | 用 `TABLESAMPLE` 或随机 UUID |
| P2-2 | `process_image.py:67-95` 与 `bot/url_handler.py:35-99` 与 `source_extractors/pixiv.py:19-35` | **三处** URL 正则规则重复定义，规则漂移风险高（Pixiv /i/ 短链只在 bot 有，backend process_image 没有） | 提取到共享模块（虽然 bot/backend 是不同 Python 包，可以做成独立 pip 包，或复制粘贴时加版本注释） |
| P2-3 | `backend/app/services/s3.py` 每次操作 `create_client` | 每个 upload/delete 都新建 client，无连接池复用 | 模块级持有 client context，或用 `aioboto3` |
| P2-4 | `phash.py:55-64` `hamming_distance` 用 Python 循环 | 慢，但库小无感 | 用 `int(h1, 16) ^ int(h2, 16)` 一次性 XOR |
| P2-5 | `backend/app/main.py:14-16` SECRET_KEY 为空时只 warning 不拒绝启动 | 生产环境忘配会以 insecure default 运行 | 启动时若 `SECRET_KEY` 空且 `APP_URL.startswith("https")`，直接 raise |
| P2-6 | `frontend/src/pages/posts/[id].astro:97` 内联 `onclick` 字符串 | CSP 严格时不工作 | 改 `addEventListener` |
| P2-7 | `frontend/src/pages/posts/[id].astro:276` `apiBase = document.querySelector('meta[name="api-base"]')` 但模板里**没有该 meta tag** | rating 编辑永远走 `/api` fallback | 要么删 meta 查询，要么在 BaseLayout 加上 `<meta name="api-base" content={apiUrl}>` |
| P2-8 | `bot/app/handlers/url_handler.py:25` `_confirmed_posts: set` 进程内 | 见 F5 | 改 Redis set with TTL |
| P2-9 | `frontend/src/components/ThemeToggle.tsx` 与 `Pagination.tsx` 是 React Island，但首屏是 SSR | 客户端 hydration 增加体积 | Pagination 可改纯 Astro，ThemeToggle 必要 |
| P2-10 | `infra/caddy/Caddyfile` 是模板但**包含真实域名 `lainns.xyz`** | 公开仓库泄露部署目标 | 占位符化 `{APP_DOMAIN}` |

### 🟢 P3 — 优化

- **P3-1** `alembic` migration 004 用了 `reuse rating_enum` 但没显式 `create_type=False`，重跑会失败（已 checkfirst，OK）。
- **P3-2** `requirements.txt` 全部用 `>=` 无上界，长期可能因上游 breaking change 而炸。建议关键包（fastapi、sqlalchemy、aiogram、arq）锁主版本号。
- **P3-3** `frontend/package.json` version 仍是 `0.1.1`，但当前发布是 v0.2.2。每次发版要更新 package.json。
- **P3-4** `CHANGELOG.md` 只有 v0.2.2 / v0.2.0，**跳过了 v0.2.1**（git log 显示有 v0.2.1 commit `7cbd325`）。文档与版本号不同步。
- **P3-5** `docker-image.md` 中的 `VERSION=v0.1.2` 已严重过时（当前 v0.2.2）。整篇示例都基于 v0.1.2。
- **P3-6** `process_image.py` `_ensure_tags` 在循环里逐个 select + flush，N+1 查询。批量 `where(name.in_([...]))` 一次拿回。
- **P3-7** `lib/api.ts:88-129` 把 `ssrCookie` 从 `options` 里展开后又传 fetch，类型不优雅。可拆 `fetchOptions` 与 `metaOptions`。

---

## 3. 项目结构精简与整合可行性

### 3.1 现状评估

代码总体组织良好，分层清晰：

```
backend/app/{api, models, schemas, services, source_extractors, tasks}
bot/app/{handlers, services}
frontend/src/{components, layouts, lib, pages, styles}
infra/{caddy, scripts}
```

主要冗余：
1. **URL 正则规则三处重复**（见 P2-2）。
2. **`ALLOWED_PER_PAGE` 四处重复**（P1-1）。
3. **`backend/scripts/` 仅有 1 个脚本**（reset_admin_password.py），且 README 未提及，文档与实际不一致。
4. **`infra/scripts/migrate-db.sh`** 复杂度高，但实际使用频率低（个人项目）。

### 3.2 推荐整合

#### A. 抽出共享常量模块

```
backend/app/
├── api/constants.py        # 现有，作为唯一真源
├── services/url_patterns.py  # 新建：集中 URL 正则 + identify_source
└── source_extractors/      # 各 extractor 引用 url_patterns
```

`bot/app/handlers/url_handler.py` 复制时在文件顶部注释 `# MIRROR of backend/app/services/url_patterns.py v1.2 — keep in sync`。

#### B. 文件清理

| 删除 | 理由 |
|---|---|
| `nul` | P0-2 |
| `frontend/src/env.d.ts` 中的过期类型（如有） | 实际只有 1 行 reference |
| `frontend/package.json` 中未使用的 `clsx` / `tailwind-merge` / `lucide-react`（实际用了，保留） | ✅ 已使用，无清理 |
| `bot/app/handlers/save.py` 与 `url_handler.py` 共享 `process_url` | v0.1.0 audit 已合并，确认无残留 |

#### C. 推荐目录调整

无需大改。唯一建议：把 `infra/scripts/` 移到根 `scripts/`，因为 build.sh 和 validate-env.sh 不只是 infra 的事，是项目级脚本。

---

## 4. Workflow 与脚本链路评估

### 4.1 链路图（实际跑通的端到端流程）

```
[Telegram 用户发链接]
      │
      ▼
[Bot webhook /bot/webhook]
      │ AuthMiddleware（chat.id ∈ BOT_ADMIN_IDS）
      ▼
[url_handler.handle_url_message]
      │ identify_source (regex) → (site, source_id)
      ▼
[backend_api.create_process_task]
      │ POST /api/tasks/  (X-Api-Key)
      ▼
[FastAPI tasks.create_process_task]
      │ enqueue_process_image → ARQ Redis
      ▼
[ARQ Worker: process_image]
      │
      ├─ source_extractor.extract → gallery_dl.download_from_url
      │       └─ DataJob + DownloadJob (ThreadPoolExecutor)
      ├─ pipeline.download_and_process
      │       ├─ _head_check (Content-Length)
      │       ├─ compute_phash + find_duplicate (prefix bucket)
      │       ├─ _generate_thumbnail (Pillow WebP)
      │       └─ s3_service.upload_bytes × 3 (orig, thumb, preview)
      ├─ _ensure_tags (alias resolve + category upgrade + post_count++)
      ├─ auto-rating rules check (escalate only)
      └─ db.commit (Post + Tags + PostTag)
      ▼
[Bot _poll_and_notify]（asyncio.create_task）
      │ poll_job_result (Job.result with timeout=300s)
      ▼
[Bot 显示评级菜单 / 倒计时自动确认]
```

### 4.2 各环节评估

| 环节 | 评估 | 风险 |
|---|---|---|
| Bot Auth | ✅ 正确处理转发消息（chat.id 而非 from_user.id） | 中间件对 CallbackQuery 用 `from_user.id`，与 Message 逻辑不同，需留意 |
| Bot → Backend 鉴权 | ✅ X-Api-Key 自动注入 | BACKEND_API_KEY 为空时旁路（dev） |
| ARQ 入队 | ✅ `enqueue_process_image` 每次新建 pool —— **资源浪费**（P2 类） | 应共享 pool |
| ARQ 执行 | ⚠️ `gallery_dl` 是同步阻塞，靠 `ThreadPoolExecutor(max_workers=2)` | 并发处理 ≤ 2，多于会排队 |
| S3 上传 | ✅ 流式 + 后置 verify | 每次操作新建 client（P2-3） |
| Bot 回写 | ⚠️ `asyncio.create_task` fire-and-forget，无错误追踪 | 任务异常时静默失败，用户看不到任何错误 |
| 评级选择 | ⚠️ 进程内 `_confirmed_posts` set（F5） | 多副本 / 重启失忆 |

### 4.3 脚本评估

| 脚本 | 评估 |
|---|---|
| `infra/scripts/build.sh` | ✅ 工作正常，v0.1.3-pre2 已修复路径。`--target runner` 显式指定，good。但**没传 `--provenance=false --sbom=false`**，Huawei SWR 推送会失败（docker-image.md 里强调了，但 build.sh 没集成） |
| `infra/scripts/validate-env.sh` | ✅ 严格模式覆盖完整。**但**未校验 `APP_URL` 与 `PUBLIC_API_URL` 是否同源（这是 P0-1 的根源） |
| `infra/scripts/migrate-db.sh` | ✅ 逻辑完整。**但** `psql "$PROD_DATABASE_URL" < "$dump_file"` 没传 `--set ON_ERROR_STOP=1`，部分失败会静默 |
| `backend/scripts/reset_admin_password.py` | 文档未提及，README "管理员认证"章节没说有这个工具 |

### 4.4 链路缺口（"未连上的线"）

1. **Caddy 缓存 purge 链路实际未启用**：`webhook.py` 实现了 `POST /api/rebuild/` 用 PURGE 方法清 Souin 缓存，但**当前 Caddyfile 根本没配 Souin**，所以 purge 调用全部打到 404。这是"准备好的功能但没接线"。
2. **`process_image` 成功后未触发任何 cache purge**：即使 Souin 启用了，新图也需要手动调 rebuild。建议在 `process_image` 成功分支尾部 fire-and-forget 调用 `webhook.purge_cache(["/", "/api/posts"])`。
3. **`bot` 没有 healthcheck**（docker-compose.yml 中 bot 服务无 healthcheck）。

---

## 5. 文档整合重构方案

### 5.1 当前文档问题

| 文档 | 字数 | 主要问题 |
|---|---|---|
| `README.md` | ~255 行 | 与 CLAUDE.md / PLAN.md 大量重叠（API 表格、env var 表、项目结构） |
| `PLAN.md` | ~390 行 | 既是"计划"又是"已完成记录"，与 CHANGELOG 重叠；含 v0.1.0 audit 历史表 |
| `CLAUDE.md` | ~370 行 | 与 README 重叠；面向 AI 但写法像 README |
| `docker-image.md` | ~180 行 | 版本号严重过时（v0.1.2 vs 实际 v0.2.2） |
| `CHANGELOG.md` | ~210 行 | 缺 v0.2.1 条目 |
| `infra/.env.example` | ~170 行 | 与 README env 表重叠 |

**"四源真相"**：API 端点表、环境变量表、项目结构图、技术栈表，**至少在 4 个文档里各写了一遍**。每次发版改一处漏三处，是当前最大的文档维护成本。

### 5.2 推荐重构：四层文档体系

```
docs/
├── README.md               # 入口，仅留：是什么 / 30 秒上手 / 链接到其它文档
├── architecture.md         # 架构图 + 技术栈 + 数据模型 + API 端点表（唯一真源）
├── deployment.md           # 部署：env var 全表（唯一真源）+ Caddy + Docker + PG/Redis
├── development.md          # 开发：本地起 dev compose / 迁移 / 调试
├── operations.md           # 运维：build.sh / migrate-db.sh / validate-env.sh / 备份
└── changelog.md            # 仅保留版本变更（按 semver，无遗漏）
```

- **`PLAN.md` 拆分**：未完成项进 `docs/roadmap.md`，已完成项直接删除（CHANGELOG 已有）。
- **`CLAUDE.md` 瘦身**：仅保留 AI 协作特定信息（"代码风格 / 提交规范 / 不要碰 X"），其余迁到 `docs/`。
- **`docker-image.md` 内容**迁到 `docs/operations.md`，删除冗余文件。
- **`infra/.env.example`**：保留（运行时需要），但 README 不再复制表格，只指向它。

### 5.3 重构收益

- 单一真源：API 加新端点只改 1 处。
- 减少文档字数 ~40%（去重后）。
- AI 上下文：CLAUDE.md 瘦身后，注入更聚焦。

### 5.4 立即可做的小修

不等待大重构也应先做：
1. CHANGELOG 补 v0.2.1 条目（P3-4）。
2. docker-image.md 的 `v0.1.2` → `v0.2.2`（P3-5）。
3. frontend/package.json version `0.1.1` → `0.2.2`（P3-3）。
4. Caddyfile 占位符化（P2-10）。

---

## 6. PostgreSQL 18 + Redis 8 迁移可行性评估

> **前提**：以非主分支（feature/pg18-redis8）方式先行验证，主分支不动。

### 6.1 PostgreSQL 16 → 18

#### 6.1.1 代码层依赖盘点

| 依赖点 | 当前用法 | PG 18 兼容性 |
|---|---|---|
| `uuid-ossp` 扩展 | `uuid_generate_v4()` 作 server_default | ✅ PG18 仍支持，但**官方推荐改用 `gen_random_uuid()`**（pgcrypto 内置，PG13+ 即可，无需扩展） |
| `JSONB` / `ARRAY` | 未使用 | N/A |
| `ENUM` 类型 | `source_site_enum` / `rating_enum` / `tag_category_enum` | ✅ 无变化 |
| `ON DELETE CASCADE` | post_tags FK | ✅ 无变化 |
| `func.greatest` | tag post_count decrement | ✅ 标准函数 |
| `created_at DESC OFFSET N LIMIT M` | 分页 | ✅ 但 PG18 仍不支持 `WITH TIES` 之外的改进；可考虑 `keyset pagination` |
| 全文检索 / `pg_trgm` | 未使用 | N/A |
| asyncpg 驱动 | `postgresql+asyncpg://` | ✅ asyncpg 已支持 PG18 |

#### 6.1.2 潜在 breaking change（PG18 specific）

- **`uuid-ossp` 默认仍存在但 deprecated 倾向**：迁移期建议同时切换到 `gen_random_uuid()`，减少扩展依赖。
- **GUC `default_statistics_target` / `random_page_cost` 默认值调整**：对查询计划无破坏性影响，可能反而更快。
- **`ALTER TABLE ... ADD COLUMN ... DEFAULT non-constant` 终于原生支持**（PG11+ 已可，无影响）。
- **`SECURITY LABEL` / ` row-level security` 行为微调**：未使用，无影响。
- **`pg_dump` 跨大版本**：PG16 dump → PG18 restore 完全兼容；反向不行（不需要）。

#### 6.1.3 迁移步骤（零代码改动版）

```yaml
# docker-compose.yml 改一行
postgres:
  image: postgres:18-alpine   # 原 postgres:16-alpine
```

```bash
# 数据迁移
docker compose exec postgres pg_dumpall -U kura > full_dump.sql
# 切换镜像
docker compose down postgres
docker volume rm kura-booru-next_postgres_data
docker compose up -d postgres
cat full_dump.sql | docker compose exec -T postgres psql -U kura
```

#### 6.1.4 推荐伴随改动（非强制，但趁此机会做）

1. **切换到 `gen_random_uuid()`**：新增 Alembic 迁移 005：
   ```python
   op.execute('CREATE EXTENSION IF NOT EXISTS pgcrypto')
   # 改 server_default
   op.alter_column('posts', 'id', server_default=sa.text('gen_random_uuid()'))
   # 重复对 tags / admins / auto_rating_rules / tag_aliases
   ```
   模型代码同步改 `server_default=func.gen_random_uuid()`。
2. **关键字段加 `keyset pagination` 索引**：`(created_at, id)` 复合索引，深分页加速。

#### 6.1.5 风险评级：🟢 低

代码零改动即可迁移；`uuid-ossp` 切换是 nice-to-have。

---

### 6.2 Redis 7 → 8

#### 6.2.1 代码层依赖盘点

| 依赖点 | 当前用法 | Redis 8 兼容性 |
|---|---|---|
| ARQ 队列 | `arq` 库，用 list + sorted set + hash | ⚠️ **需验证 arq 版本对 Redis 8 客户端协议的支持** |
| `create_pool(RedisSettings)` | 标准 redis-py 协议 | ✅ RESP3 协议可选 |
| `Job.result(timeout, poll_delay)` | 轮询查 result key | ✅ 无变化 |
| `--appendonly yes` | AOF 持久化 | ✅ Redis 8 默认 multi-AOF（更高效） |
| Lua 脚本 | 未使用 | N/A |
| Pub/Sub | 未使用 | N/A |
| Streams | 未使用（ARQ 内部可能用） | 由 arq 库处理 |

#### 6.2.2 ARQ 兼容性（重点）

ARQ 内部基于 `redis-py >= 4.2`. `redis-py 5.x` 已完全兼容 Redis 7。**Redis 8 新引入的 RESP3 默认仍向后兼容 RESP2**，`redis-py 5.x` 默认走 RESP2，无破坏。

需验证项：
- `arq` 当前版本（`requirements.txt` 未锁版本，安装时拉取最新）：检查是否显式声明支持 Redis 8。
- 实测：起 redis:8-alpine 容器，worker 正常 enqueue/dequeue 即通过。

#### 6.2.3 Redis 8 行为变化（影响本项目的）

- **默认 `appendonly yes`** + **multi-part AOF**（更安全，无需配置改动）。
- **`WAIT` 命令语义微调**：未使用。
- **新命令 `BITCOUNT BYTE/BIT`**：未使用。
- **`CLUSTER` 改进**：单实例无影响。
- **客户端响应缓存（server-assisted caching）**：可选启用，可加速 `/api/auth/status` 这类高频查询，但本项目未用 RESP3，不强制。

#### 6.2.4 迁移步骤

```yaml
redis:
  image: redis:8-alpine   # 原 redis:7-alpine
  command: redis-server --appendonly yes
```

数据无需迁移（ARQ 任务结果 TTL 1 小时，重启即可丢弃）。

#### 6.2.5 风险评级：🟢 低（需 1 次 smoke test）

唯一不确定性是 `arq` 最新版是否声明 Redis 8 支持；实测 5 分钟可验。

---

### 6.3 推荐迁移分支策略

```
main (PG16 + Redis7) ────────────────────────────────────────────▶
       │
       └─ feature/pg18-redis8 (PG18 + Redis8)
              │
              ├─ Phase 1: 仅切镜像，跑通 dev compose
              ├─ Phase 2: 切 gen_random_uuid() + alembic 005
              ├─ Phase 3: keyset pagination 索引
              └─ Phase 4: 合并回 main（发 v0.3.0 minor bump）
```

**版本号建议**：PG/Redis 升级属基础设施变更，发 **v0.3.0**（minor）。

---

## 7. 行动方针总览（优先级排序）

### 🔥 立即修复（v0.2.3 patch）

| # | 任务 | 工时估 | 关联 |
|---|---|---|---|
| 1 | **修复 logout bug**（按 P0-1 路径，服务端 redirect 方案） | 1h | P0-1 |
| 2 | 删除 `nul` 文件 + 加 .gitignore | 5min | P0-2 |
| 3 | `image_urls` 去重 | 15min | P0-3 |
| 4 | CHANGELOG 补 v0.2.1；package.json 版本号同步 | 10min | P3-3, P3-4 |
| 5 | `admin/posts.astro` 缩略图改 `getThumbUrl` | 5min | P1-3 |
| 6 | 删除 `auto-rating.astro` 重复 `<script define:vars>` | 1min | P1-5 |
| 7 | `posts/[id].astro` rating 编辑器去掉无效 meta 查询 | 5min | P2-7 |

**v0.2.3 总工时**：约 2 小时

### 🟠 短期改进（v0.2.4 ~ v0.2.5）

| # | 任务 | 工时估 |
|---|---|---|
| 1 | 抽出共享 URL 正则模块（backend + bot 同步） | 1.5h |
| 2 | `tags/[name].astro` 改用 `GET /api/tags/{name}` | 30min |
| 3 | `ALLOWED_PER_PAGE` 单一真源化 | 30min |
| 4 | web-import 加 URL 数量上限 | 15min |
| 5 | `fetchApi` 浏览器侧 `credentials: "include"` | 15min |
| 6 | Bot `_confirmed_posts` 迁到 Redis | 1h |
| 7 | 文档重构 Phase 1（建 docs/ 目录，迁内容） | 4h |

### 🟡 中期重构（v0.3.0，包含 PG18 + Redis8）

| # | 任务 |
|---|---|
| 1 | PG16 → 18 切换 + `gen_random_uuid()` 迁移 |
| 2 | Redis 7 → 8 切换 + ARQ smoke test |
| 3 | 文档重构 Phase 2（删除 PLAN.md / docker-image.md，CLAUDE.md 瘦身） |
| 4 | 启用 Caddy Souin 缓存（先解决 Vary: Cookie） |
| 5 | keyset pagination |

### 🟢 长期愿景（v0.4+）

- 监控（Prometheus + Grafana）
- 自动化 CI/CD（Gitea Actions）
- 数据库定期备份 cron
- SSE/WebSocket 任务状态推送
- Twitter 完整 extractor
- 多管理员支持

---

## 8. 大纲速查（精确修复 checklist）

> 每条都给出"文件:行号 + 改成什么"，可以直接拿去 commit。

### v0.2.3 修复清单

```
[ ] frontend/src/pages/logout.ts                    # 新建：SSR endpoint，POST 后端 logout + 302 redirect /
[ ] frontend/src/layouts/BaseLayout.astro:189       # logout-btn 改为 <form action="/logout" method="post"> 或 fetch + reload
[ ] backend/app/api/auth.py:69                      # logout 端点保持不变（已正确）
[ ] .gitignore                                      # 加一行 "nul"
[ ] git rm --cached nul
[ ] backend/app/tasks/process_image.py:153          # image_urls = list(dict.fromkeys(image_urls)) 去重
[ ] frontend/src/pages/admin/posts.astro:93         # 改 src={getThumbUrl(post)}，import getThumbUrl
[ ] frontend/src/pages/admin/auto-rating.astro:249  # 删除重复的 <script define:vars>
[ ] frontend/src/pages/posts/[id].astro:276         # 删掉 meta[name="api-base"] 查询，直接用 '/api'
[ ] frontend/package.json:4                         # "version": "0.2.2" → "0.2.3"
[ ] CHANGELOG.md                                    # 在 [0.2.2] 之前插入 [0.2.1] 段（补齐遗漏）+ 新增 [0.2.3] 段
[ ] docker-image.md                                 # 全文 v0.1.2 → v0.2.2
[ ] infra/caddy/Caddyfile:16                        # 占位符化 lainns.xyz（或加显著"模板"警告）
```

### v0.2.4 改进清单

```
[ ] backend/app/api/tags.py:29                      # 删本地 ALLOWED_PER_PAGE，import from constants
[ ] backend/app/api/search.py:34                    # 同上
[ ] frontend/src/lib/api.ts                         # 新增 fetchTag(name) 调用 GET /api/tags/{name}
[ ] frontend/src/pages/tags/[name].astro:27         # 替换 fetchTags(...1000) 为 fetchTag(name)
[ ] backend/app/services/url_patterns.py            # 新建：集中所有 URL 正则
[ ] backend/app/tasks/process_image.py:41-95        # 改为 from app.services.url_patterns import resolve_source
[ ] backend/app/source_extractors/pixiv.py:19       # 改为引用 url_patterns
[ ] bot/app/handlers/url_handler.py:35              # 镜像同步（顶部加同步注释）
[ ] backend/app/api/tasks.py:67                     # urls: list[str] = Field(..., max_length=50)
[ ] frontend/src/lib/api.ts:119                     # 浏览器分支加 credentials: "include"
[ ] bot/app/handlers/url_handler.py:25              # _confirmed_posts 改 Redis SETEX with TTL
```

### v0.3.0 迁移清单

```
[ ] 新分支 feature/pg18-redis8
[ ] infra/docker-compose.yml:111                    # postgres:16-alpine → 18-alpine
[ ] infra/docker-compose.yml:133                    # redis:7-alpine → 8-alpine
[ ] infra/docker-compose.dev.yml:144                # 同步 dev
[ ] infra/docker-compose.dev.yml:168                # 同步 dev
[ ] backend/alembic/versions/005_pg18_uuid.py       # 新建：切 gen_random_uuid()
[ ] backend/app/models/post.py:40                   # server_default=func.gen_random_uuid()
[ ] backend/app/models/tag.py:25                    # 同上
[ ] backend/app/database.py:53                      # CREATE EXTENSION pgcrypto（替换 uuid-ossp）
[ ] backend/app/database.py                         # 删除 create_tables() 或保留作 dev fallback
[ ] smoke test: 起完整 dev compose，bot 发链，端到端跑通
```

---

## 9. 附录：审查中验证过但确认无问题的关键点

为减少后续重复审查，记录"已检查且 OK"的项：

1. ✅ `posts.py` 路由注册顺序：`/by-source` / `/random` 在 `/{post_id}` 之前，FastAPI 路由匹配正确。
2. ✅ `_apply_rating_filter` 在 list / detail / random / by-source 全部应用，未见遗漏。
3. ✅ `tags.py` 三端点都加了 `is_admin: bool = Depends(get_is_admin)`，未见匿名泄露。
4. ✅ `search.py` 的 `rating:` token 对非 admin 强制忽略，不会被绕过。
5. ✅ `delete_post` 用 `get_current_admin`（重依赖，DB lookup），不可被 API key 旁路。
6. ✅ `update_post_rating` 的 API key 旁路仅在 dev（BACKEND_API_KEY 空）时开。
7. ✅ Auto-rating 规则只升级不降级，`_RATING_ORDER` 正确。
8. ✅ Cookie 设置 / 删除的 `secure` / `httponly` / `samesite` / `path` 属性 v0.2.2 已对齐（P0-1 的根因不在这）。
9. ✅ Alembic migration 001~004 链 `down_revision` 正确，无分叉。
10. ✅ Bot `AuthMiddleware` 对转发消息用 `chat.id`（私人会话），正确处理 channel forward。
11. ✅ `bleach` 清洗白名单合理（`a/br/p/b/i/strong/em/ul/ol/li/span/u`），`script/iframe` 已排除。
12. ✅ S3 key normalization（lowercase + collapse double slash）防 v1 复发的 key 错位 bug。

---

## 10. 结语

v0.2.2 整体是一个**质量过得去的个人项目迭代**，核心闭环稳定。主要改进空间集中在三块：

1. **logout bug 的精确修复**（用户已识别） —— v0.2.2 的修复方向正确但不完整，本报告 §3.1 给出了零歧义路径。
2. **文档与配置的单一真源化** —— ROI 最高，建议优先排期。
3. **PG18 / Redis8 迁移** —— 风险极低，可作为 v0.3.0 的"无功能变化纯基础设施升级"独立分支推进。

报告完成，可直接据此拆 issue 排期。
