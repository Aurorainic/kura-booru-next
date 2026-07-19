# spike/imgproxy — imgproxy 可行性验证（plan.md §F3）

验证 v0.9.0 缩略图选型的三个决策输入。结论已写入 `docs/adr/adr-0003-thumbnails.md`。

## 复现

```bash
cd spike/imgproxy
# 生成密钥（.env.spike 被根 .gitignore 的 .env.* 规则覆盖，不入库）
printf "IMGPROXY_KEY_HEX=%s\nIMGPROXY_SALT_HEX=%s\n" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env.spike
# 测试图 fixtures/test.jpg 由 sharp 生成（2400x1600 jpeg），已在库内
docker compose --env-file .env.spike up -d --wait   # MinIO（S3 替身）+ imgproxy
node sign.mjs                                       # 签名 URL 生成 + 全量验证
docker compose down -v                              # 清理
```

## 验证项与结论（imgproxy 4.0.11）

| 验证项 | 结果 |
|---|---|
| ① 从 S3/MinIO 源出缩略图 | PASS — `rs:fit:{w}:0` 六档全部 200，返回 WebP，像素宽度精确（100/300/640/1280/2000 均实测命中） |
| ② 防 SSRF（CVE-2025-24354） | PASS — 签名合法的 loopback 源（`127.0.0.1`、`localhost`→`[::1]`）被拒；白名单外源（example.com）被拒；无签名请求 403 |
| ③ 多档宽度签名 URL | PASS — Node `crypto` HMAC-SHA256(key, salt+path) base64url，十几行无依赖实现，与前端 srcset（100w–2000w）直接对接 |

## 实施时注意（demo 中踩到的）

- **v4 改名**：`IMGPROXY_ALLOWED_SOURCE_URL_PREFIXES`（v3）→ `IMGPROXY_ALLOWED_SOURCES`（v4）。配错名字**不报错、不生效**，等于白名单失守——上线前必须用 off-prefix 用例回归。
- **私网源必须显式放行**：MinIO/S3 在 docker 内网（RFC1918），需 `IMGPROXY_ALLOW_PRIVATE_SOURCE_ADDRESSES=true`；loopback 保持 `false`（v3.28+ 默认值，显式声明）。两道闸叠加 `IMGPROXY_ALLOWED_SOURCES` 白名单才是完整防 SSRF 姿势。
- **拒绝回 404 不是 403**：loopback/白名单拦截在 v4 返回 404（错误信息里带原因），测试断言不要写死 403。
- **MinIO 需匿名下载策略**：imgproxy 以普通 HTTP GET 取源，bucket 要 `mc anonymous set download`（或换预签名源 URL 方案）。
- compose 用 `:latest` 是 spike 行为；落地时应 pin 版本 tag。

## 与 `/i/` 反代（server/routes/i/[...].ts，43 行）的衔接评估

现状：`/i/<key>` → 透传 `S3_EXTERNAL_URL/<key>`（Range 转发 + 流式 + `max-age=31536000`）。

imgproxy 落地后的推荐形态：**`/i/` 路由保留、上游换成 imgproxy**——
`/i/<key>?w=300` → 内部签名后转发 `imgproxy:8080/rs:fit:300:0/<base64url(S3_URL/key)>.webp`。
理由：前端 URL 形态不变（`composables/utils.ts` 只拼 `/i/<key>`），签名密钥不出 server，
`/i/` 仍是无签名外露面；Range/流式语义保留给原图档位（`w=full` 时直转 S3 或 imgproxy 原样档）。
详见 adr-0003。
