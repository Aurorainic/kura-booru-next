/**
 * Redis client lifecycle — close on Nitro shutdown. Without it every hot-reload
 * leaks a redis TCP connection (saw 36k over 4 days); closing on shutdown is
 * enough for single-instance deploy; multi-replica would want a shared pool.
 */
import { _client, _blockingClient } from '../utils/redis'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', async () => {
    try {
      if (_blockingClient) await _blockingClient.quit()
    } catch { /* already closed */ }
    try {
      await (_client as any).quit?.()
    } catch { /* already closed */ }
  })
})
