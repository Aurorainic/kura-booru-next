# AI Retag 运行原理与维护指南

> 版本：v0.7.0
> 最后更新：2026-06-30
> 本文档面向 AI coding agent，用于排查和优化此 feature。
>
> **注意**: 中 ARQ worker 已移除，AI 标签处理逻辑现在在 Nitro 进程内执行（`server/utils/` 下的函数）。整体流程不变，但实现语言从 Python 迁移到了 TypeScript。本文档 §三–§八 保留了 v1 的内部机制描述作为参考，v0.7.0 的对应文件见 `server/utils/` 和 `server/routes/api/`。

---

## 一、功能概述

AI Retag 在新图入库时自动调用 OpenAI 兼容 API，对标签进行 5 类分类（artist/character/copyright/general/meta）+ 中文翻译 + Danbooru 标准命名。结果缓存到 `tag_knowledge` 表，避免重复调用。

---

## 二、数据流总览

```
图像导入流
  └─ ARQ worker: process_image()
       ├─ _ensure_tags(db)           → 创建 Tag 记录，默认 general
       ├─ _ai_process_tags(db, tags)  ← 【核心】AI 二次处理
       │    ├─ lookup_tags()          → tag_knowledge 缓存查询（独立 session）
       │    ├─ classify_tags()        → OpenAI API 调用（无 DB）
       │    ├─ batch_upsert_tag_knowledge() → 写缓存（独立 session）
       │    └─ db.flush()             → 刷新 Tag 记录（外层 session）
       └─ db.commit()                → 外层统一提交

管理后台重处理
  └─ POST /api/admin/tags/reprocess
       ├─ (可选) UPDATE tags SET ai_processed_at = NULL
       └─ enqueue ARQ job: reprocess_tags(force=...)
            ├─ get_unprocessed_tag_names() / select all tags
            ├─ per-batch (50 tags):
            │    ├─ classify_tags(batch)       → OpenAI API
            │    ├─ batch_upsert_tag_knowledge() → 写缓存（session 1）
            │    └─ UPDATE Tag records          → 更新分类（session 2）
            └─ return stats

管理后台编辑
  └─ PATCH /api/admin/tags/{id}
       ├─ UPDATE Tag 记录（分类/翻译/danbooru_name）
       ├─ UPSERT TagKnowledge 记录（source = 'manual'）
       └─ commit
```

---

## 三、涉及文件索引

### 后端

| 文件 | 职责 | 行数 | 关键函数/类 |
|------|------|------|-------------|
| `app/config.py` | 环境变量 | ~80 | `AI_PROVIDER_API_KEY`, `AI_PROVIDER_ENDPOINT`, `AI_PROVIDER_MODEL`, `ENABLE_AI_TAG_PROCESSING` |
| `app/models/tag.py` | Tag 模型 | 48 | `TagCategory` enum, `Tag` 类（新增 `danbooru_name`, `translation`, `ai_processed_at`） |
| `app/models/tag_knowledge.py` | 知识库模型 | 51 | `TagKnowledgeSource` enum, `TagKnowledge` 类 |
| `app/models/post.py` | Post 模型 | 84 | `Post` 类（新增 `ai_tag_processed_at`, `ai_tag_status` — ⚠️ 见下方已知问题） |
| `app/schemas/tag.py` | 请求/响应 Schema | 84 | `TagRead`, `TagUpdate`, `TagKnowledgeRead`, `TagMergeRequest`, `TagReprocessRequest` |
| `app/services/ai_tag.py` | AI API 调用 | 173 | `classify_tags()`, `parse_ai_response()`, `_get_client()`, `SYSTEM_PROMPT` |
| `app/services/tag_knowledge.py` | 知识库 CRUD | 159 | `lookup_tags()`, `upsert_tag_knowledge()`, `batch_upsert_tag_knowledge()`, `get_unprocessed_tag_names()` |
| `app/tasks/process_image.py` | ARQ 任务 | 516 | `process_image()`, `_ai_process_tags()`, `reprocess_tags()`, `_ensure_tags()` |
| `app/tasks/worker.py` | Worker 配置 | 85 | `WorkerSettings.functions = [process_image, reprocess_tags]` |
| `app/api/admin_tags.py` | 管理后台 API | 286 | `list_admin_tags`, `update_tag`, `merge_tags`, `reprocess_tags`, `list_tag_knowledge` |
| `app/api/__init__.py` | 路由注册 | 33 | `/api/admin/tags` 前缀 |
| `alembic/versions/005_...py` | 数据库迁移 | 134 | tags +3 列, posts +2 列, tag_knowledge 建表 |

### 前端

| 文件 | 职责 |
|------|------|
| `app/composables/api.ts` | `Tag` 接口（`danbooru_name`, `translation`）、`fetchAdminTags()`, `updateAdminTag()`, `mergeTags()`, `reprocessTags()`, `updatePostTags()` |
| `app/pages/admin/index.vue` | 标签管理页面（列表/编辑/合并/重处理，`?tab=tags` 子标签） |
| `app/pages/admin/index.vue` | 图片管理页面（新增标签列显示，`?tab=posts` 子标签） |
| `app/pages/posts/[id].vue` | 详情页（管理员可添加/移除标签） |
| `app/components/TagBadge.vue` | 统一标签展示组件 |

> 以下 §三–§八 为 v1 (Python/Astro) 的内部机制，保留作参考。对应 v0.7.0 逻辑在 `server/utils/` 和 `server/routes/api/` 中。

---

## 四、关键设计决策

### 4.1 Session 隔离

`_ai_process_tags(db, tags)` 接收外层 `process_image` 的 `db` session，但内部调用 `lookup_tags()` 和 `batch_upsert_tag_knowledge()` 时各自创建**独立 session**。

```
process_image session ───┬── _ai_process_tags(db) ── db.flush()
                         │        │
                         │        ├── lookup_tags()         ← 独立 session（只读）
                         │        └── batch_upsert_tag_knowledge() ← 独立 session（写入并 commit）
                         │
                         └── db.commit() ← 外层统一提交
```

**为什么这样设计**：`tag_knowledge` 服务是通用模块，可能被管理后台、定时任务等不同上下文调用，不能假设调用方一定传 session。

**风险**：如果 `batch_upsert_tag_knowledge()` 成功但外层 `db.commit()` 失败，知识库已写入但 Tag 记录未更新。可通过重处理修复。

### 4.2 AI 失败不阻塞入库

```python
# process_image 中的调用方式
try:
    await _ai_process_tags(db, tags)
except Exception as exc:
    logger.warning("AI tag processing failed (non-blocking): %s", exc)
```

AI 调用失败只记日志，不阻塞图片入库。Tag 的 `ai_processed_at` 保持 `None`，下次同标签的新图入库时会重试。

### 4.3 知识库缓存优先

`_ai_process_tags` 先查 `tag_knowledge` 缓存，命中则直接复用，未命中才调 AI API。知识库是 truth source，Tag 表是冗余副本。

### 4.4 人工编辑覆盖

管理后台编辑标签后，`tag_knowledge.source` 标记为 `'manual'`。当前代码中 `manual` 和 `ai` source 在缓存查询时**同等对待**——人工编辑会覆盖 AI 结果，但 AI 重处理不会跳过 `source='manual'` 的条目（这是已知缺陷，见 §6.3）。

---

## 五、环境变量

```bash
AI_PROVIDER_API_KEY=sk-xxx          # 必填
AI_PROVIDER_ENDPOINT=https://api.deepseek.com/v1  # 必填，OpenAI 兼容 API 地址
AI_PROVIDER_MODEL=deepseek-v4-flash # 必填，模型名
ENABLE_AI_TAG_PROCESSING=true       # 总开关，False 时完全跳过
```

- 三个 `AI_PROVIDER_*` 缺一不可，缺少时 AI 处理静默跳过（不报错）
- `ENABLE_AI_TAG_PROCESSING=false` 时 `_ai_process_tags` 直接 return

---

## 六、已知问题与陷阱（AI Agent 必读）

### 6.1 🚨 `async_session` vs `async_session_factory`

**这是本 feature 最容易犯的错误。**

`app/database.py` 导出的是 `async_session_factory`（一个 `async_sessionmaker` 实例），不是 `async_session`。

```python
# ❌ 错误 — 会 ImportError
from app.database import async_session

# ✅ 正确
from app.database import async_session_factory

# 使用方式
async with async_session_factory() as session:
    ...
```

**历史**：早期版本曾用 `async_session` 命名，后改为 `async_session_factory`。`tag_knowledge.py` 曾因此导致 `reprocess_tags` 任务在 worker 中 ImportError 崩溃。

**检查方法**：修改任何 `app/services/` 或 `app/tasks/` 文件时，grep 确认导入正确（v1 路径，仅供参考）：
```bash
grep -rn "from app.database import" backend/app/services/ backend/app/tasks/
```

### 6.2 🚨 `Post.ai_tag_processed_at` / `ai_tag_status` 未使用

Migration 005 和 Model 中已定义这两个字段，但代码**从未写入**。它们目前是死字段。

- `ai_tag_processed_at` 本意是标记"此帖子的标签已由 AI 处理"
- `ai_tag_status` 本意是跟踪处理状态（`pending`/`processing`/`done`/`error`）

**影响**：管理后台无法按帖子维度查看 AI 处理状态，只能按标签维度（`Tag.ai_processed_at`）。

**修复方向**：在 `_ai_process_tags` 和 `reprocess_tags` 中更新这两个字段。

### 6.3 ⚠️ `reprocess_tags` 中的事务分裂

`reprocess_tags` ARQ 任务中，知识库写入和 Tag 更新使用不同 session：

```python
# 先写知识库（session 1，自 commit）
await batch_upsert_tag_knowledge(knowledge_entries, source="ai")

# 再更新 Tag 记录（session 2，自 commit）
async with async_session_factory() as db:
    await db.execute(update(Tag).where(...).values(...))
    await db.commit()
```

如果 session 2 失败，知识库已写入但 Tag 未更新。不会数据损坏（下次重处理可修复），但不一致。

### 6.4 ⚠️ `datetime.utcnow()` 写入 timezone-aware 列

多处使用 `datetime.utcnow()`（naive datetime）写入 `DateTime(timezone=True)` 列。PostgreSQL 接受但不规范。应使用 `datetime.now(timezone.utc)` 或 `func.now()`。

**涉及位置**：
- `process_image.py: _ai_process_tags` 中 `tag.ai_processed_at = datetime.utcnow()`
- `process_image.py: reprocess_tags` 中 `ai_processed_at=datetime.utcnow()`
- `tag_knowledge.py: upsert_tag_knowledge` 中 `updated_at=datetime.utcnow()`

### 6.5 ⚠️ `tag_knowledge.type` 用 String 而非 Enum

`Tag.category` 用 `Enum(TagCategory, name="tag_category_enum")`，但 `TagKnowledge.type` 用 `String`。数据库层面无约束，可写入任意字符串。

### 6.6 ⚠️ `parse_ai_response` 中的 `str.index("\n")`

```python
first_newline = text.index("\n")  # 如果 text 是 "```" 会抛 ValueError
```

应改用 `text.find("\n")` 或 `text.split("\n", 1)`。

### 6.7 ⚠️ merge_tags 不合并 TagKnowledge

`merge_tags` 将源标签的帖子关联移到目标标签，但**不处理** `tag_knowledge` 表。源标签的知识库条目变成孤儿记录。

### 6.8 ⚠️ AI 重处理不跳过 `source='manual'`

`reprocess_tags` 会覆盖人工编辑的结果，因为缓存查询和 AI 调用不区分 source。应增加逻辑：`source='manual'` 的知识库条目跳过 AI 重处理。

### 6.9 ⚠️ 前端 `getTagCategoryColorClass` 不存在

`api.ts` 导出的是 `getTagCategoryColor`，不是 `getTagCategoryColorClass`。`TagBadge.vue` 曾因此 build 失败（已修复，但其他新增代码可能再犯）。

### 6.10 ⚠️ Alembic 路径遮蔽问题

在 Docker 容器中运行 `alembic` 命令时，`/app/alembic/` 目录会遮蔽 Python 包 `alembic`（site-packages）。需要特殊处理：

```bash
# ❌ 直接运行会 ImportError: cannot import name 'app.config'
docker run ... alembic upgrade head

# ✅ 需要绕过路径遮蔽
docker run ... python -c "
import sys, importlib
sys.path = [p for p in sys.path if p != '/app' and p != '']
sys.path.append('/app')
alembic_mod = importlib.import_module('alembic.config')
sys.exit(alembic_mod.CommandLine().main(argv=['upgrade', 'head']))
"
```

---

## 七、调试速查

### 查看 worker 中的 AI 处理日志

```bash
docker logs kura-worker 2>&1 | grep -E "AI|ai_tag|classify|reprocess"
```

### 手动触发单个标签的 AI 处理

```bash
# 进入 backend 容器
docker exec -it kura-backend python -c "
import asyncio
from app.services.ai_tag import classify_tags
result = asyncio.run(classify_tags(['初音ミク', 'long_hair']))
print(result)
"
```

### 查看知识库缓存命中情况

```bash
docker exec kura-postgres psql -U kura -d kurabooru -c \
  "SELECT source, COUNT(*) FROM tag_knowledge GROUP BY source;"
```

### 查看未处理标签数量

```bash
docker exec kura-postgres psql -U kura -d kurabooru -c \
  "SELECT COUNT(*) FROM tags WHERE ai_processed_at IS NULL;"
```

### 重置所有标签为未处理（触发完整重处理）

```bash
docker exec kura-postgres psql -U kura -d kurabooru -c \
  "UPDATE tags SET ai_processed_at = NULL;"
```

### 检查 AI Provider 连通性

```bash
curl -s https://api.deepseek.com/v1/models \
  -H "Authorization: Bearer $AI_PROVIDER_API_KEY" | head -20
```

---

## 八、修改此 Feature 时的 Checklist

- [ ] 确认 `from app.database import async_session_factory`（不是 `async_session`）
- [ ] 确认前端 `getTagCategoryColor`（不是 `getTagCategoryColorClass`）
- [ ] 如修改 `_ai_process_tags`，注意外层 session 由 `process_image` 管理，不要在此函数中 commit
- [ ] 如修改 `tag_knowledge.py` 中的函数，注意它们创建独立 session 并自行 commit
- [ ] 如修改 `reprocess_tags`，注意知识库写入和 Tag 更新的 session 分裂问题
- [ ] 如新增字段，需要同步修改：Model → Schema → Migration → 前端 api.ts 类型
- [ ] `is:inline` 脚本必须纯 ES5 JS（无 `as`、箭头函数、模板字面量）
- [ ] Tag 名入库前必须 `.strip().lower()`
- [ ] Alembic migration 在 Docker 中运行需绕过路径遮蔽（见 §6.10）
