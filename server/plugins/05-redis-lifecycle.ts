/**
 * Redis client lifecycle — close on Nitro shutdown.
 *
 * Without this, every Nitro hot-reload leaves a dangling redis TCP connection.
 * Over time the redis maxclients / client-tracking list grows; we saw 36k
 * connections history over 4 days. Closing on shutdown is enough for a
 * single-instance deploy; multi-replica would want a shared client pool.
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
