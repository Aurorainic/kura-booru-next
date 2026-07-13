import { createClient } from 'redis'

// ponytail: single connection reused across Nitro — fine for personal site
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379/0'

// Exported so the lifecycle plugin can quit on shutdown. Outside callers
// must go through getRedis() — the lazy-singleton wrapper handles connect().
export const _client = createClient({ url: redisUrl })
_client.on('error', (err) => console.error('[redis]', err))

let _connected = false

export async function getRedis() {
  if (!_connected) {
    await _client.connect()
    _connected = true
  }
  return _client
}

// Lazy singleton: first call connects, subsequent calls reuse
// redis v6 uses UPPERCASE command names (LPUSH, BRPOP, etc.)
export const redis = new Proxy({} as ReturnType<typeof createClient>, {
  get(_, prop) {
    const key = typeof prop === 'string' ? prop.toUpperCase() : prop
    return (...args: any[]) => getRedis().then(c => (c as any)[key](...args))
  },
})

// Dedicated client for blocking operations (BRPOP) — separate from shared proxy
// to prevent BRPOP from blocking the shared connection for all other Redis commands.
// Exported so the lifecycle plugin can quit on shutdown.
export let _blockingClient: ReturnType<typeof createClient> | null = null
export async function getBlockingRedis() {
  if (!_blockingClient) {
    _blockingClient = createClient({ url: redisUrl })
    await _blockingClient.connect()
  }
  return _blockingClient
}
