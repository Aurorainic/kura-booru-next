# Kura Booru Next — 全面代码审查报告 (v0.1.0 清理前)

> 审查日期：2026-06-19
> 审查范围：Backend / Frontend / Bot / Infra / Docs
> 目的：发布 v0.1.0 前的冗余清理与架构整合

---

## 一、Backend 审查

### 1.1 死代码 / 冗余模块

#### `app/services/source_resolver.py` — 🔴 建议删除/合并
- `resolve_source()`：从未被调用（死代码）
- 只有 `resolve_source_or_other()` 在 `process_image.py` 中使用一次
- 各 extractor（pixiv.py、twitter.py、danbooru.py）已自行解析 URL，source_resolver 的价值有限
- **行动**：将 `resolve_source_or_other()` 逻辑内联到 `process_image.py`，删除 `source_resolver.py`

#### `app/services/__init__.py` — 🟡 建议完善
- 当前为空文件
- **行动**：导出常用服务（`s3_service`、`compute_phash` 等），减少其他模块的长路径导入

### 1.2 重复逻辑

#### `ALLOWED_PER_PAGE = {20, 40, 100}` — 🔴 建议提取
- 在 `posts.py`、`search.py`、`tags.py` 中完全相同定义
- **行动**：新建 `app/api/constants.py`，定义一次，三处导入

#### `ImageOps.exif_transpose` — 🟡 重复导入
- `pipeline.py` 第 114 行和第 208 行各导入一次
- **行动**：保留顶部导入，删除函数内的重复

### 1.3 未使用的 Schema

#### `PostCreate`、`TagCreate` — 🟡 建议删除
- 定义在 `app/schemas/post.py` 和 `app/schemas/tag.py` 中
- 没有任何路由、service 或 task 实例化或引用它们
- **行动**：直接删除。若未来需要 Admin API，届时重新添加

### 1.4 Config 导入不一致

#### `main.py` vs 其他模块 — 🟡 建议统一
- `main.py`：`from app.config import settings`（模块级单例）
- 其他模块：`from app.config import get_settings()`（函数调用）
- **行动**：`main.py` 改用 `get_settings()`，保持一致性

### 1.5 依赖检查

- `requirements.txt` 中 14 个包全部使用，无冗余
- `python-multipart` 可能被 `fastapi[standard]` 自动带入，显式声明无害

---

## 二、Frontend 审查

### 2.1 死代码 / 冗余文件

#### `src/components/PhotoAlbum.tsx` — 🔴 必须删除
- 已被 `PhotoAlbum.astro` 完全替代
- 所有页面（index.astro、search.astro、tags/[name].astro）均导入 `.astro` 版本
- 即使它还在，内部也重复了每个 Tailwind 类名 + 硬编码 `style={{}}`（双份样式）
- **行动**：`rm frontend/src/components/PhotoAlbum.tsx`

#### `tailwind.config.mjs/` — 🔴 必须删除
- 这是一个**空目录**（被 root 拥有），不是文件
- Tailwind v4 已改用 CSS-based `@theme` 配置（在 `globals.css` 中）
- **行动**：`rm -rf frontend/tailwind.config.mjs/`

### 2.2 未使用的 npm 依赖

| 包名 | 状态 | 说明 |
|---|---|---|
| `react-photo-album` | 🔴 未使用 | 从未 import，已被纯 CSS Grid 替代 |
| `@tanstack/react-query` | 🔴 未使用 | 无 `useQuery`、`QueryClientProvider` |
| `class-variance-authority` | 🔴 未使用 | 无 `cva()` 调用 |

- **行动**：`cd frontend && npm uninstall react-photo-album @tanstack/react-query class-variance-authority`

### 2.3 `src/lib/api.ts` 冗余

#### 未使用的导出
- `fetchRandomPost()`：无任何页面/组件调用
- `TagsResponse`：没有任何地方 import
- **行动**：删除

#### 重复的分页默认值
- `index.astro`、`search.astro`、`tags/[name].astro` 都重复：
  ```ts
  const perPage = Math.min(100, Math.max(1, parseInt(Astro.url.searchParams.get("per_page") || "40")));
  ```
- 空结果 fallback 对象也在三处重复：
  ```ts
  data = { items: [], total: 0, page: 1, per_page: 40, total_pages: 0 };
  ```
- **行动**：在 `api.ts` 中定义 `DEFAULT_PER_PAGE = 40`、`MAX_PER_PAGE = 100`、`clampPerPage()`、`emptyPostsResponse()`

### 2.4 `tags/index.astro` 重复颜色映射

- 内联定义了 `categoryColorMap` 对象，与 `api.ts` 的 `getTagCategoryColor()` 完全重复
- **行动**：删除 `categoryColorMap`，改用 `getTagCategoryColor()` / `getTagCategoryLabel()`

### 2.5 硬编码值

| 位置 | 值 | 建议 |
|---|---|---|
| `BaseLayout.astro` | `gitTag = "90f0508"` | 改为构建时注入 `import.meta.env.PUBLIC_GIT_TAG` |
| `BaseLayout.astro` | Gitea 链接 | 改为 `import.meta.env.PUBLIC_REPO_URL` |
| `api.ts` | fallback API URL | 可以接受，但可显式定义常量 |

### 2.6 Astro Islands 使用评估

| 组件 | 指令 | 评估 |
|---|---|---|
| `ThemeToggle` | `client:load` | ✅ 正确，需要即时交互 |
| `SearchBar` | `client:load` | ✅ 正确，需要即时交互 |
| `Pagination` | `client:visible` | ✅ 正确，滚动到才需要 JS |
| `PhotoAlbumGrid` | 无（.astro） | ✅ 正确，纯 SSR |

---

## 三、Bot 审查

### 3.1 严重重复：`save.py` ≈ `url_handler.py`

- 两者的工作流完全重复：
  1. 提取 URL（正则匹配）
  2. `identify_source(url)` 识别来源
  3. `create_process_task(...)` 创建后台任务
  4. `_poll_and_notify(...)` 轮询并编辑消息
- `save.py` 的唯一额外逻辑是解析 `/save <url>` 或 `!save <url>` 语法
- **行动**：
  - 在 `url_handler.py` 中新增 `async def process_url(message, url)` 辅助函数
  - `save.py` 简化为：解析命令 → 提取 URL → 调用 `process_url(message, url)`

### 3.2 死代码

#### `arq_client.enqueue_process_image()` — 🔴 删除
- Bot 从不直接 enqueue ARQ 任务，而是通过 HTTP API (`backend_api.create_process_task`)
- 保留 `poll_job_result()` 即可
- **行动**：从 `arq_client.py` 中删除 `enqueue_process_image()`

#### `info.py` 未使用导入 — 🟡 清理
- 导入了 `get_post` 但实际只调用了 `get_post_by_source`
- **行动**：删除 `get_post` import

### 3.3 硬编码 URL

| 位置 | 硬编码值 | 建议 |
|---|---|---|
| `url_handler.py` (×2) | `https://kura-booru.lainns.xyz/posts/{post_id}` | `config.py` 新增 `FRONTEND_URL` |

### 3.4 依赖检查

- `requirements.txt` 中全部使用，无冗余
- `arq` 仅用于 `poll_job_result()`（不用于 enqueue），占用合理

---

## 四、Infra / Docker / Caddy 审查

### 4.1 Caddyfile 审查

- `/api/*` 和 `/bot/webhook` 已正确配置无缓存
- Frontend SSR 走默认 `handle` 到 `:4321`
- ⚠️ **缺少 `/i/*` S3 代理**：当前图片走 `S3_EXTERNAL_URL` 直接访问 R2，不经过 Caddy
  - 如果后续需要 Caddy 缓存图片或统一域名，需要添加 `/i/*` 路由
  - 当前配置是可行的（直接 R2 更快），但应在文档中说明

### 4.2 Docker Compose

- 三阶段 Dockerfile（dev/builder/prod）设计合理
- `docker-compose.dev.yml` 的 volume mounts 正确
- ⚠️ 环境变量 `.env` 中 `S3_PROXY_UPSTREAM` 已定义但 Caddyfile 未使用

---

## 五、文档审查

### 5.1 `CLAUDE.md` 需要更新

- "Phase 1-3 code complete" → 改为 "v0.1.0 Released"
- "Current Status" 列表中移除过时的未完成项：
  - ~~`npm install` and test frontend build~~ → 已完成
  - ~~Database migration `alembic upgrade head`~~ → 已完成
  - ~~End-to-end test~~ → 已完成
  - ~~Caddy setup~~ → 已完成
- 新增已知问题/待办：
  - Tag `post_count` 自动同步（当前需手动 SQL）
  - 更多 source extractors（Twitter、Danbooru 待完善）
  - phash dedup 优化
- 更新项目结构：删除已移除的文件（PhotoAlbum.tsx、source_resolver.py 等）

### 5.2 `PLAN.md` 需要更新

- 标记所有已实现功能为 ✅
- 将 Phase 4 内容转为 Roadmap（不放在当前计划中）
- 添加 v0.1.0 功能清单和里程碑说明

---

## 六、修复优先级 (P0 → P3)

### P0 — 必须修复（影响功能或架构）
1. 删除 `PhotoAlbum.tsx`（死代码，干扰阅读）
2. 删除 `tailwind.config.mjs/` 空目录
3. 合并 `save.py` 到 `url_handler.py`（逻辑重复，维护双份风险）
4. 删除 `source_resolver.py`（死代码文件）

### P1 — 强烈建议（提高可维护性）
5. 移除未使用 npm 依赖（减少 bundle size）
6. 提取 `ALLOWED_PER_PAGE`（消除 3 处重复）
7. 删除 `PostCreate`/`TagCreate` 未使用 schemas
8. 删除 `enqueue_process_image()`（死代码）
9. 清理 `api.ts` 死导出（`fetchRandomPost`、`TagsResponse`）

### P2 — 推荐（代码整洁）
10. 统一 config 导入模式
11. 修复 `pipeline.py` 重复导入
12. 删除 `info.py` 未使用 import
13. 提取 `DEFAULT_PER_PAGE`/`MAX_PER_PAGE`/`clampPerPage()`
14. `tags/index.astro` 改用 `getTagCategoryColor()`

### P3 — 优化（提升体验）
15. Bot `config.py` 新增 `FRONTEND_URL`
16. `BaseLayout.astro` gitTag 改为环境变量注入
17. `BaseLayout.astro` Gitea 链接改为环境变量

---

## 七、v0.1.0 发布流程

```bash
# 1. 执行所有 P0+P1+P2 清理
# 2. 验证
npm run build                          # frontend
python -m py_compile app/**/*.py       # backend syntax check
python -m py_compile bot/app/**/*.py   # bot syntax check

# 3. 重启全栈
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml restart

# 4. Smoke test
#    Bot 发送链接 → 收到"已加入队列" → 收到"处理完成" → 前端可见

# 5. Git
git add -A
git commit -m "cleanup: remove dead code, deduplicate logic, v0.1.0 prep"
git tag -a v0.1.0 -m "v0.1.0: core features complete (bot → worker → s3 → frontend)"
git push origin v0.1.0
```

---

## 八、下次 Session 的待办

按优先级顺序执行上方 P0 → P3 的修复项，完成后进行：
- 更新 `CLAUDE.md`（当前状态、项目结构）
- 更新 `PLAN.md`（已完成项、Roadmap）
- Git commit + tag v0.1.0 + push
- 端到端 smoke test
