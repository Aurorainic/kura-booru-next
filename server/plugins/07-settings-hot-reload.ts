/**
 * 设置热刷新接线（v0.10.0）。
 *
 * 注册 settings 变更后的刷新钩子：
 *   - S3 客户端重建（resetS3Client）
 *   - Telegram Bot 实例重建（rebuildBot — token/apiRoot/adminIds 生效）
 *   - Pixiv 凭证同步到 Redis（sidecar 从 Redis 读取，避免改 sidecar 环境）
 * 同时启动时把 DB 中的 Pixiv 凭证同步一次（幂等）。
 */

import { onSettingsChanged, getPixivConfig, getSettings } from '../utils/settings'

async function syncPixivToRedis() {
  try {
    const { redis } = await import('../utils/redis')
    const pixiv = await getPixivConfig()
    const { getImageSizes } = await import('../utils/settings')
    const sizes = await getImageSizes()
    const all = await getSettings()
    // 仅当 DB 已 seed（有 pixiv 键）时写入；否则 sidecar 仍用 env 回退。
    if ('pixiv_refresh_token' in all || 'pixiv_phpsessid' in all) {
      await redis.set('kura:pixiv:refresh_token', pixiv.refreshToken || '')
      await redis.set('kura:pixiv:phpsessid', pixiv.phpsessid || '')
    }
    await redis.set('kura:max_image_size', String(sizes.maxImageSize))
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
