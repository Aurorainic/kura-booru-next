/**
 * 设置热刷新接线（v0.10.0）。
 *
 * 注册 settings 变更后的刷新钩子：
 *   - S3 客户端重建（resetS3Client）
 *   - Telegram Bot 实例重建（rebuildBot — token/apiRoot/adminIds 生效）
 *   - Pixiv 凭证同步到 Redis（sidecar 从 Redis 读取，避免改 sidecar 环境）
 * 同时启动时把 DB 中的 Pixiv 凭证同步一次（幂等）。
 */

import { onSettingsChanged, getPixivConfig } from '../utils/settings'

async function syncPixivToRedis() {
  try {
    const { redis } = await import('../utils/redis')
    const pixiv = await getPixivConfig()
    const { getImageSizes } = await import('../utils/settings')
    const sizes = await getImageSizes()
    // 仅当至少一个 Pixiv 凭证有值时才写入 Redis，避免空串覆盖 sidecar 的 env 回退。
    if (pixiv.refreshToken || pixiv.phpsessid) {
      await redis.set('kura:pixiv:refresh_token', pixiv.refreshToken || '')
      await redis.set('kura:pixiv:phpsessid', pixiv.phpsessid || '')
    }
    await redis.set('kura:max_image_size', String(sizes.maxImageSize))
    // 下载代理同步到 Redis（sidecar 读取，gallery-dl 使用）
    const { getDlProxyConfig } = await import('../utils/settings')
    const dlProxy = await getDlProxyConfig()
    await redis.set('kura:dl_proxy_type', dlProxy.proxyType || '')
    await redis.set('kura:dl_proxy_url', dlProxy.proxyUrl || '')
  } catch (err) {
    console.warn('[settings] pixiv redis sync failed (non-fatal):', err)
  }
}

export default defineNitroPlugin(async () => {
  // 注册热刷新钩子
  onSettingsChanged(async () => {
    const { resetS3Client } = await import('../utils/s3')
    resetS3Client()
    const { rebuildBot } = await import('../utils/bot')
    await rebuildBot()
    await syncPixivToRedis()
  })

  // 启动时同步一次 Pixiv 凭证（幂等；Redis 未就绪时静默跳过）
  await syncPixivToRedis()
  console.log('[settings] hot-reload hooks registered')
})
