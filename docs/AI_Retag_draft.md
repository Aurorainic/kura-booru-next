# AI Retag 方案草案 (v0.4.0)

> 本草案由 Kimi 2.6 与用户共同讨论形成，作为 v0.4.0 开发阶段的交接材料。
> 记录时间：2026/06/21

---

## 背景与动机

当前标签分类依赖 `recategorize_tags.py` 脚本，该脚本硬编码知识库极小（仅2个角色名、几个展会名），导致大量标签被错误归类为 `general`。为了接轨 Danbooru 标签标准、提升标签质量与可维护性，引入 DeepSeek AI（OpenAI 兼容 API）对标签进行二次处理。

---

## 核心设计决策

### 1. 数据库标签三名称体系

| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | 原始标签名（入库时不变） | `初音ミク` |
| `danbooru_name` | Danbooru 标准命名（AI 确认） | `hatsune_miku` |
| `translation` | 中文翻译（AI 生成） | `初音未来` |

**原则**：
- 原 tag 为最终准，搜索和数据库关联以 `name` 为准
- `danbooru_name` 用于知识库关联和后续扩展
- 中文翻译仅用于前端展示层

### 2. 分类体系（保留 5 类）

经讨论确认保留 Danbooru 标准 5 类分类：

| 分类 | 定义 | 前端展示 |
|------|------|----------|
| `artist` | 画师署名/笔名/Pixiv 外显名 | 蓝色底色 |
| `character` | 动漫/游戏/VTuber 角色名 | 粉色/红色底色 |
| `copyright` | 作品/IP/游戏/动画名称 | 紫色底色 |
| `general` | 描述性标签（外貌、动作、场景等） | 灰色/绿色底色 |
| `meta` | 元信息（ popularity 标签等） | 黄色底色 |

**Pixiv 用户名处理**：当前脚本自动提取 Pixiv 外显名作为 artist，**不经过 AI 判断**，保持现有逻辑。

### 3. AI 处理范围

- **纯文本处理**：AI 只接收标签字符串列表，不看图片
- **处理时机**：
  - 新图入库时自动触发（ARQ worker 流水线）
  - 现有图片批量处理（管理后台按钮 + 启动时自动检测未处理）
- **缓存机制**：`tag_knowledge` 数据库存储已处理标签，新图入库时先查库，命中则直接复用

### 4. 前端标签展示（Pixiv 风格）

所有展示位置（除 PhotoAlbum 悬停外）均采用：

```
【原标签名（标准字体） 中文翻译（小字，颜色略淡）】
```

展示位置：
- ✅ 详情页左侧边栏（按分类分组）
- ✅ 标签云页面（`tags/index.astro`）
- ✅ 搜索自动补全下拉
- ✅ 搜索结果的标签列表
- ❌ PhotoAlbum 悬停标签（保持简洁，只显示原 tag）

---

## System Prompt 设计草案

```markdown
你是一位二次元插画标签分类与翻译专家。请对输入的标签列表进行分析。

## 分类标准（5类）

1. **artist** - 画师的署名、笔名、Pixiv/Twitter ID
   - 例：lack, モ誰, ask_(askzy), mocha_(mochamoca)
   - 注意：Pixiv 用户外显名如果像人名/笔名，归入此类

2. **character** - 动漫、游戏、VTuber 角色名
   - 例：hatsune_miku, ganyu_(genshin_impact), 猫又おかゆ
   - 注意：原创角色(OC)无特定名称的不归入此类

3. **copyright** - 作品、IP、游戏、动画、漫画名称
   - 例：vocaloid, fate_grand_order, pokemon, original
   - 注意：原创插画标记为 "original"

4. **general** - 描述画面内容的普通标签
   - 包括：外貌特征(发色/瞳色/服装)、动作、场景、物品、情绪
   - 例：long_hair, blue_eyes, school_uniform, smile

5. **meta** - 与画面内容无关的元信息
   - 例：1000users入り, translated, highres, commentary_request

## 处理规则

- 输入标签保持原样，不要修改命名（如不要空格改下划线）
- 对每个标签判断最可能的分类
- 提供简体中文翻译：
  - 角色名使用中文圈通用译名（Bilibili/萌娘百科/维基百科标准）
  - 画师名一般不翻译（保留原文）
  - 描述性标签翻译为自然中文
  - 作品名使用官方中文译名（如有）
  - meta 标签可不翻译或直译

## 输出格式

严格返回 JSON，不要 markdown 代码块：

{
  "tags": [
    {
      "name": "原始标签名（完全不变）",
      "type": "artist|character|copyright|general|meta",
      "translation": "中文翻译（无则空字符串）",
      "danbooru_name": "Danbooru标准命名（小写+下划线）"
    }
  ]
}
```

---

## 数据库变更计划

### Tag 表扩展

```sql
ALTER TABLE tags ADD COLUMN danbooru_name VARCHAR;
ALTER TABLE tags ADD COLUMN translation VARCHAR;
ALTER TABLE tags ADD COLUMN ai_processed_at TIMESTAMP;
```

### 新增 TagKnowledge 表（知识库）

```sql
CREATE TABLE tag_knowledge (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR UNIQUE NOT NULL,           -- 原始标签名（小写）
    danbooru_name VARCHAR,                  -- Danbooru 标准名
    type VARCHAR NOT NULL,                  -- artist|character|copyright|general|meta
    translation VARCHAR,                    -- 中文翻译
    source VARCHAR DEFAULT 'ai',            -- 'ai' | 'manual' | 'danbooru_import'
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Post 表扩展（处理状态跟踪）

```sql
ALTER TABLE posts ADD COLUMN ai_tag_processed_at TIMESTAMP;
ALTER TABLE posts ADD COLUMN ai_tag_status VARCHAR DEFAULT 'pending';  -- pending/processing/done/error
```

---

## API 变更计划

### 后端 API

1. **Tag Schema 扩展**
   - `TagRead` 增加 `danbooru_name`, `translation` 字段

2. **新增 Admin Tag API**
   - `GET /api/admin/tags` - 标签列表（含未处理/已处理筛选）
   - `PATCH /api/admin/tags/{id}` - 编辑标签（分类、翻译、Danbooru 名）
   - `POST /api/admin/tags/merge` - 合并标签（将源标签的所有帖子移到目标标签）
   - `POST /api/admin/tags/reprocess` - 触发批量重处理

3. **AI 处理服务**
   - 新增 `app/services/ai_tag.py` - DeepSeek API 调用封装
   - 新增 `app/services/tag_knowledge.py` - 知识库查询/写入

4. **ARQ 任务扩展**
   - `process_image` 任务增加 AI 标签处理步骤
   - 新增 `reprocess_tags` 批量任务

### 前端变更

1. **API 类型扩展**
   - `Tag` 接口增加 `danbooru_name`, `translation`

2. **标签展示组件**
   - 新增 `TagBadge.astro` - 统一标签展示（原 tag + 翻译小字 + 分类底色）
   - 更新 `tags/index.astro` - 使用新组件
   - 更新 `posts/[id].astro` - 侧边栏标签展示翻译
   - 更新搜索自动补全 - 显示翻译

3. **管理后台**
   - 新增 `admin/tags.astro` - 标签管理页面（列表、编辑、合并、批量重处理）
   - 更新 `admin/posts.astro` - 帖子标签显示翻译

---

## 流水线变更

### 新图入库流程（AI 标签处理插入点）

```
[ARQ Worker: process_image]
      │
      ├─ source_extractor.extract → gallery_dl.download_from_url
      ├─ pipeline.download_and_process (phash, thumb, S3)
      ├─ _ensure_tags (创建 Tag 记录，默认 general)
      ├─ 【新增】ai_tag_processor.process (AI 二次分类+翻译)
      │       ├─ 查 tag_knowledge 表，命中则复用
      │       ├─ 未命中则调用 DeepSeek API
      │       ├─ 写入 tag_knowledge 表
      │       └─ 更新 Tag 记录 (category, danbooru_name, translation)
      ├─ auto-rating rules check
      └─ db.commit
```

---

## 批量处理策略

1. **启动时自动检测**
   - 检查 `posts` 表中 `ai_tag_processed_at IS NULL` 的记录
   - 加入 ARQ 队列逐张处理

2. **管理后台手动触发**
   - 按钮"处理未处理标签" - 只处理 `ai_tag_status != 'done'` 的
   - 按钮"重新处理所有标签" - 覆盖式重跑（危险操作，需二次确认）

---

## 环境变量

```bash
# DeepSeek API 配置（OpenAI 兼容）
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_API_BASE=https://api.deepseek.com/v1  # 或用户自定义地址
DEEPSEEK_MODEL=deepseek-chat

# AI 标签处理开关
ENABLE_AI_TAG_PROCESSING=true
```

---

## 风险与兜底

1. **AI 返回非法 JSON**
   - 脚本校验层检查输出格式
   - 非法时标记 `ai_tag_status = 'error'`，写入日志，不阻塞入库

2. **AI 分类错误**
   - 管理后台提供编辑能力，人工纠偏
   - 纠偏后更新 `tag_knowledge` 表，后续复用

3. **API 调用失败/限流**
   - ARQ 任务支持重试（max_retries=3）
   - 失败后标记 `error`，管理员可手动重试

4. **成本问题**
   - 逐张图调用，但标签缓存机制减少重复调用
   - 批量处理时可考虑聚合多张图的标签列表一次性调用

---

## 待决策事项（需下一个 agent 确认）

1. **是否需要在 Alembic 中创建新的 migration？** 是的，需要 005_add_tag_fields_and_knowledge.sql
2. **前端标签展示的颜色方案是否需要调整？** 当前已有 5 色方案，可直接沿用
3. **是否引入 tag implications（标签继承）？** 本次不涉及，留作未来扩展
4. **AI 批量调用优化**：是否将多张图的标签聚合后一次性调用？（当前设计为逐张图处理）

---

## 相关文件索引

| 文件 | 说明 |
|------|------|
| `backend/app/models/tag.py` | Tag 模型，需扩展字段 |
| `backend/app/tasks/process_image.py` | ARQ 任务，需插入 AI 处理步骤 |
| `backend/app/api/tags.py` | Tag API，需扩展 admin 接口 |
| `frontend/src/pages/tags/index.astro` | 标签云页面 |
| `frontend/src/pages/posts/[id].astro` | 详情页标签侧边栏 |
| `frontend/src/components/PhotoAlbum.astro` | 悬停标签（不显示翻译） |
| `frontend/src/lib/api.ts` | API 客户端类型定义 |

---

*本草案由 Kimi 2.6 生成，等待下一个 coding agent 接手实现。*
