# ADR-0003: 缩略图方案 —— 维持 sharp 内嵌 + 导入期预生成多档（imgproxy 存档为已验证备选）

- 状态：已接受（2026-07-19）
- 关联：v0.9.0 规划文档 §F3 / 硬约束 4（已随仓库清理移除，见 git 历史）；技术验证：imgproxy（10/10 PASS，验证代码已随仓库清理移除，结论见本文）
- 决策输入：backend-audit §2.3、§6；frontend-audit §6.1、§6.2-1（审计文档已随仓库清理移除，见 git 历史；结论见本文）

## 背景

前端审计确认"无响应式图片"是明确短板：preview 只出一张图，没有 `srcset/sizes`，2x 屏手机和桌面拿同一张（frontend-audit §6.2-1）。v0.9.0 规划 §F3 给出两条路：imgproxy 通过则 srcset 近乎免费（100w–2000w 按需生成）；维持 sharp 则导入期预生成 2–3 档。

现状事实：

- sharp 缩略图三件套（thumb 300² / preview 1280 / LQIP 20²，webp）在 **pipeline 导入链路**离线生成（`pipeline.ts:95-115 ≈ 460-476`，backend-audit §2.3），**不在请求路径上**——请求路径的 `/i/[...].ts`（43 行）只是 Range 透传 + 流式反代（§6）。
- 真 LQIP（sharp base64 内联 SSR HTML）是前端确认的性能资产（frontend-audit §6.1）。
- 硬约束：v0.9.0 规划「明确不做」写明**容器数不增**（现 4 个：web/worker/postgres/redis）。
- 数据规模：数百 posts、单机部署（backend-audit §5）。

## 验证结论（imgproxy 4.0.11 + MinIO）

imgproxy 验证环境实测 10/10 PASS（验证代码已随仓库清理移除，结论见本文）：

- **S3 源出图**：`rs:fit:{w}:0` 六档（100/240/300/640/1280/2000w）全部 200，WebP 输出，像素宽度实测精确命中。
- **防 SSRF（CVE-2025-24354）**：签名合法的 loopback 源（`127.0.0.1`、`localhost`→`[::1]`）被拒（404 + "Loopback source address is not allowed"）；白名单外源被拒；无签名请求 403。完整配置 = `IMGPROXY_ALLOW_LOOPBACK_SOURCE_ADDRESSES=false` + `IMGPROXY_ALLOW_PRIVATE_SOURCE_ADDRESSES=true`（MinIO 在 docker 内网，必须放行）+ `IMGPROXY_ALLOWED_SOURCES` 源前缀白名单。
- **签名 URL**：Node `crypto` HMAC-SHA256 十几行无依赖实现，与 100w–2000w srcset 档位直接对接。

技术上 imgproxy 完全可行；决策因此落在**约束与收益权衡**上。

## 选项

| 选项 | 内容 | 评估 |
|---|---|---|
| A. imgproxy 容器 | 按需任意宽度、解放 CPU、srcset 免费 | +1 容器直接违反「容器数不增」（plan 明确不做）；"解放 API 进程 CPU"收益被高估——sharp 在导入链路离线跑，低频后台活动，非请求路径（§2.3）；数百 posts 单机规模无需独立缩略图服务 |
| **B. sharp 内嵌 + 预生成多档** | 导入期在现有三件套基础上预生成 srcset 档位，存 S3 | 零新容器；srcset 落地（消 §6.2-1 短板）；LQIP/链路全不动；代价是档位固定（改档需回填） |
| C. 维持现状 | 只有 thumb/preview | 不解决 §6.2-1，否决 |

## 决策

**选 B：维持 sharp 内嵌，导入期预生成多档宽度；imgproxy 存档为已验证备选。**

1. **预生成档位**：pipeline 的缩略图步骤（`pipeline.ts:95-115` 与 `460-476` 两处重复块，拆分后归入 `pipeline/steps/thumbnails`）从三件套扩展为多档：thumb（300w）、mid（640w）、preview（1280w）、large（2000w）+ LQIP 20² 不变，全部 webp 存 S3 独立 key。档位映射 plan §F3 的 100w–2000w 梯度的物理子集。
2. **前端 srcset 联动**（plan §F3）：PhotoCard / posts/[id] 主图改 `<img srcset="… 300w, … 640w, … 1280w, … 2000w" sizes="…">`，配合 F2 档案馆化的响应式列数（≈6/8/10/12 列）选择 sizes 断点；LQIP blur-up 链路不动（§6.1 资产保留）。存量 posts 的档位回填脚本随阶段 2 数据层修正一并提供（先 dry-run，硬约束）。
3. **`/i/` 反代去向**：**保留不变**。它是 §6 标注的不可变契约（43 行，Range 透传 + 流式 + `max-age=31536000` 刻意不加 immutable）；预生成档位以独立 S3 key 存放，`/i/<key>` 透传逻辑零改动，前端仍只拼 `/i/<key>`（frontend-audit §5.1 `composables/utils.ts`）。
4. **imgproxy 存档**：技术验证已确认可行性，完整防 SSRF 配置模板与签名实现曾留存于验证环境（已随仓库清理移除，可从 git 历史取回），要点含 v4 将 `IMGPROXY_ALLOWED_SOURCE_URL_PREFIXES` 改名为 `IMGPROXY_ALLOWED_SOURCES` 的坑——配错不报错不生效，启用前必须用 off-prefix 用例回归。若未来约束放宽（容器数）或宽度档位需求爆炸（档案馆多档尺寸切换实时化），可从 git 历史取回验证配置直接启用，衔接方式为 `/i/` 路由保留、上游换成内部签名的 imgproxy（URL 形态不变，密钥不出 server）。

## 后果

- **正面**：零新容器，符合硬约束 4；srcset 短板消除；`/i/` 契约、LQIP、CDN 缓存链路全不变；pipeline 两处缩略图重复块随拆分一次性去重（§2.3 既定工作）。
- **负面**：档位固定，新增档位要回填存量（数百 posts 量级，回填成本可接受）；S3 存储增加（每 post 多 2 档 webp，量级 KB–几十 KB，可忽略）；导入耗时略增（离线路径，无用户感知）。
- **不做**：请求时按需缩略图；`@nuxt/image` 模块引入（frontend-audit §1.2：零 Nuxt 模块现状保持，srcset 手写即可）。
