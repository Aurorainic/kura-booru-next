# ADR-0002: 搜索索引选型 —— 删除 RediSearch，autocomplete 走 PG trgm

- 状态：已接受（2026-07-19）
- 关联：v0.9.0 规划文档 §B7（三选一，倾向项 = 本决策；规划文档已随仓库清理移除，见 git 历史）
- 决策输入：backend-audit §5（完整证据链）、§3.5-3（Redis 用途）、§4.1（trgm 索引）（审计文档已随仓库清理移除，见 git 历史；结论见本文）

## 背景

审计确认 `MEILI_ENABLED` 是**三重名不副实**（backend-audit §5）：

1. **不是 Meilisearch**：`MEILI_ENABLED=true` 实际开启的是 RediSearch。全部实现位于 `server/utils/search/suggest.ts`——`FT.CREATE kura:tagidx`（`suggest.ts:24-36`）、`FT.SEARCH @name:%prefix%`（`suggest.ts:86-90`），零新增依赖直接 `sendCommand`。
2. **不管"搜索"只管"自动补全"**：主搜索 `/api/search` → `searchPosts`（`queries.ts:267-364`）是纯 SQL EXISTS/NOT EXISTS 子查询，**完全不经过 RediSearch**；RediSearch 唯一服务的端点是 `/api/tags/autocomplete`（`autocomplete.get.ts:9` → `suggestTags`）。
3. **索引新鲜度半失守**：同步 = 启动全量重建（`07-redis-index-sync.ts`，`MEILI_ENABLED!=='true'` 时整体 no-op，L18）+ 写穿透仅挂在 `admin/tags/[id].patch.ts:54` 一处。pipeline 导入时 post_count 自增不触发索引更新（`pipeline.ts:176` 只改 PG）；`deleteTagIndex`（`suggest.ts:51-54`）定义后**全仓零调用**——merge / fix-artist 删 tag 都不同步索引。

第 3 点的隐含证据值得强调：索引里的 post_count 排序权重持续漂移直到下次重启，而这个质量退化**从未被任何人发现或报障**——说明 RediSearch 版 autocomplete 相对 SQL 兜底的体验差异小到无感。

同时，PG 侧的条件已经齐备：`tags` 表自带 3 个 trgm GIN 索引（name/translation/danbooru_name，`server/schema/tags.ts`，§4.1）；`suggest.ts:64-71` 里已存在 SQL ILIKE 兜底实现，可平滑升级为主实现；数据量为数百 posts / ~1.5k tags（§5），该量级下 trgm/ILIKE 与 RediSearch 无性能差异。

## 选项

| 选项 | 内容 | 评估 |
|---|---|---|
| a. 改名小修 | `MEILI_ENABLED` → `REDISEARCH_ENABLED`，补写穿透 + 删除同步 | 为一个"唯一职责都没干好且无人察觉"的索引继续付维护成本；补同步要动 pipeline、merge、fix-artist 三条写路径，工作量不小于删掉它 |
| **b. 删掉走 PG trgm** | 删 `suggest.ts` 的 RediSearch 实现 + `07-redis-index-sync` 插件 + `MEILI_ENABLED`；autocomplete 走 PG trgm/ILIKE | 主搜索零影响（本来就不碰它）；少一类 Redis 用途（§3.5-3）；少一个 Nitro 插件；已有 GIN 索引与 SQL 兜底可直接承接 |
| c. 真接 Meilisearch | 按当前数据量无收益证据（§5）；且超 feature parity，v0.9.0 规划「明确不做」已排除，另立版本再议 | 否决（本期） |

## 决策

**选 b：删除 RediSearch，autocomplete 走 PG trgm。**

- 删除：`suggest.ts` 中 `FT.*` 实现与 `deleteTagIndex` 死代码、`server/plugins/07-redis-index-sync.ts`、`MEILI_ENABLED` 环境变量。
- 承接：`autocomplete.get.ts` 改调基于 trgm/ILIKE 的 `suggestTags` SQL 实现（前缀优先 + post_count 排序，复用 `suggest.ts:64-71` 兜底逻辑的思路，归入 `modules/search/` repo）。
- 排序质量反而修复：post_count 改从 PG 实时取，不再漂移。

## 后果

- **正面**：消灭名不副实配置；少一类 Redis 用途（配合 ADR-0001，Redis 职责进一步向"缓存/限流/会话/sidecar 桥"收敛）；少一个 Nitro 插件；写路径零同步负担；行为对外不变（端点、参数、响应形状不动，feature parity）。
- **负面**：失去 RediSearch 的容错匹配（`suggest.ts:86-90` 的 1 字符容错）——在 1.5k tags 量级可用 `similarity()` 排序补偿，实测影响可忽略；若未来 tags 量级增长两个数量级，按选项 c 另立 ADR 评估 Meilisearch/Typesense。
- **前端影响**：零。SearchBar 的 autocomplete 调用契约不变（frontend-audit §3.1 SearchBar.vue 的 250ms debounce + AbortController 链路不动）。
