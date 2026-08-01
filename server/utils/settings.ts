import { db } from './db'
import { settings } from '../schema/settings'
import { eq } from 'drizzle-orm'
import { isAiEnabled } from '../lib/ai/config'
import { SETTING_DEFS, SETTING_DEF_MAP, SECRET_KEYS, maskSecret, type SettingCategory } from './settings-defs'

let settingsCache: Record<string, string> = {}
let settingsCacheAt = 0
const SETTINGS_TTL = 10_000

export async function getSettings(): Promise<Record<string, string>> {
  const now = Date.now()
  if (now - settingsCacheAt < SETTINGS_TTL && Object.keys(settingsCache).length > 0) {
    return settingsCache
  }
  const rows = await db.select().from(settings)
  settingsCache = Object.fromEntries(rows.map((r: any) => [r.key, r.value]))
  settingsCacheAt = now
  return settingsCache
}

/** 立即失效缓存（写入后调用，保证下次读取命中新值）。 */
export function bustSettingsCache() {
  settingsCacheAt = 0
}

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const all = await getSettings()
  return all[key] ?? fallback
}

export async function getPublicSettings() {
  const all = await getSettings()
  return {
    site_title: all.site_title || SETTING_DEF_MAP.site_title?.default || 'Kura Booru',
    site_description: all.site_description || '',
    site_url: all.site_url || SETTING_DEF_MAP.site_url?.default || '',
    announcement: all.announcement || '',
    head_inject: all.head_inject || '',
    maintenance_mode: all.maintenance_mode || 'false',
    // v0.9.0: feature flag only (never keys/endpoints) — drives the footer AI
    // badge now that the toggle lives in the DB instead of build-time env.
    ai_enabled: String(isAiEnabled()),
    // v0.10.0: run_mode 迁入 DB（默认 intranet），驱动 UI 隐藏登录/退出入口。
    intranet_mode: String(all.run_mode !== 'public'),
  }
}

/** 运行模式：'intranet'（内网，默认）| 'public'（公网）。DB settings，env 已移除。 */
export async function getRunMode(): Promise<'intranet' | 'public'> {
  const all = await getSettings()
  return all.run_mode === 'public' ? 'public' : 'intranet'
}

/**
 * 管理员视角设置（后台 7 类卡片）。
 * 返回 { key, value, category, type, label, description, public, secret, masked }：
 *   - secret 项 value 恒为空串，另行返回 masked 掩码串（不回显明文）
 *   - readonly 项（infra/admin）value 为当前 env 值（仅展示）
 */
export async function getAdminSettings() {
  const all = await getSettings()
  const items = SETTING_DEFS.map((def) => {
    const raw = all[def.key] ?? def.default ?? ''
    if (def.type === 'readonly') {
      const envVal = def.env ? process.env[def.env] : undefined
      return {
        key: def.key,
        category: def.category,
        type: def.type,
        label: def.label,
        description: def.description,
        note: def.note,
        placeholder: def.placeholder || '',
        options: def.options || [],
        value: envVal || raw,
        secret: false,
        masked: '',
      }
    }
    if (SECRET_KEYS.has(def.key)) {
      return {
        key: def.key,
        category: def.category,
        type: def.type,
        label: def.label,
        description: def.description,
        placeholder: def.placeholder || '',
        options: def.options || [],
        public: false,
        value: '',
        secret: true,
        masked: maskSecret(raw),
      }
    }
    return {
      key: def.key,
      category: def.category,
      type: def.type,
      label: def.label,
      description: def.description,
      placeholder: def.placeholder || '',
      options: def.options || [],
      public: !!def.public,
      value: raw,
      secret: false,
      masked: '',
    }
  })
  return items
}

/**
 * 批量更新设置。只接受注册表内的键；secret 项若传入空串则视为「保持原值」。
 * 写入后立即失效缓存（热刷新）。
 */
export async function updateSettings(updates: Record<string, string>) {
  const allowed = new Set(SETTING_DEFS.map(d => d.key))
  for (const [key, value] of Object.entries(updates)) {
    if (!allowed.has(key)) continue
    // secret 项空串 = 不修改
    if (SECRET_KEYS.has(key) && value === '') continue
    await db.insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
  }
  bustSettingsCache()
  // 触发依赖方的热刷新钩子（S3 客户端重建、bot 重建、sidecar 凭证同步等）。
  await refreshSettings()
}

/** 初始化 seed：将 env 中的既有值（或默认值）写入 DB（幂等，不覆盖已存在的记录）。 */
export async function seedSettingsFromEnv() {
  const all = await getSettings()
  for (const def of SETTING_DEFS) {
    if (def.type === 'readonly') continue
    const key = def.key
    if (key in all) continue // 已存在则不覆盖
    const envVal = def.env ? process.env[def.env] : undefined
    const value = envVal !== undefined && envVal !== '' ? envVal : (def.default ?? '')
    await db.insert(settings)
      .values({ key, value })
      .onConflictDoNothing()
  }
  bustSettingsCache()
}

// ── 热刷新钩子：各依赖方注册自己的刷新函数，updateSettings 后统一调用 ──

type RefreshHook = () => Promise<void> | void
const refreshHooks: RefreshHook[] = []

export function onSettingsChanged(hook: RefreshHook) {
  refreshHooks.push(hook)
}

export async function refreshSettings() {
  for (const hook of refreshHooks) {
    try { await hook() }
    catch (err) { console.error('[settings] refresh hook failed:', err) }
  }
}

// ── 类型化配置读取（供各消费方使用，均带 env 回退） ──

export async function getSiteUrl(): Promise<string> {
  const all = await getSettings()
  return all.site_url || process.env.SITE_URL || SETTING_DEF_MAP.site_url?.default || 'http://localhost:3000'
}

export async function getS3Config() {
  const all = await getSettings()
  return {
    region: all.s3_region || process.env.S3_REGION || 'auto',
    endpoint: all.s3_endpoint || process.env.S3_ENDPOINT || undefined,
    accessKeyId: all.s3_access_key || process.env.S3_ACCESS_KEY || '',
    secretAccessKey: all.s3_secret_key || process.env.S3_SECRET_KEY || '',
    bucket: all.s3_bucket || process.env.S3_BUCKET || 'kura-booru',
    externalUrl: all.s3_external_url || process.env.S3_EXTERNAL_URL || '',
  }
}

export async function getBotConfig() {
  const all = await getSettings()
  return {
    token: all.bot_token || process.env.BOT_TOKEN || '',
    webhookSecret: all.bot_webhook_secret || process.env.BOT_WEBHOOK_SECRET || '',
    adminIds: (all.bot_admin_ids || process.env.BOT_ADMIN_IDS || '').split(',').map(Number).filter(Boolean),
    proxyType: all.bot_proxy_type || process.env.BOT_PROXY_TYPE || '',
    proxyUrl: all.bot_proxy_url || process.env.BOT_PROXY_URL || '',
    siteUrl: await getSiteUrl(),
  }
}

export async function getPixivConfig() {
  const all = await getSettings()
  return {
    refreshToken: all.pixiv_refresh_token || process.env.PIXIV_REFRESH_TOKEN || '',
    phpsessid: all.pixiv_phpsessid || process.env.PIXIV_PHPSESSID || '',
  }
}

export async function getBackendApiKey(): Promise<string> {
  const all = await getSettings()
  return all.backend_api_key || process.env.BACKEND_API_KEY || ''
}

export async function getImageSizes() {
  const all = await getSettings()
  const num = (k: string, d: number) => {
    const v = parseInt(all[k] || '', 10)
    return Number.isFinite(v) && v > 0 ? v : d
  }
  return {
    thumbSize: num('thumb_size', 300),
    previewSize: num('preview_size', 1280),
    maxImageSize: parseInt(all.max_image_size || process.env.MAX_IMAGE_SIZE || '0', 10) || 0,
  }
}

/** SSRF prevention: check if hostname resolves to private/internal IP */
export async function isPrivateHost(hostname: string): Promise<boolean> {
  const addresses = await dnsLookupAll(hostname)
  if (!addresses.length) return true

  const { isIP } = await import('node:net')
  return addresses.some((ip: string) => {
    const type = isIP(ip)
    if (type === 0) return true // not an IP

    if (type === 6) {
      // IPv6
      const lower = ip.toLowerCase()
      if (lower === '::1' || lower === '::') return true
      // IPv4-mapped: ::ffff:x.x.x.x — extract and check IPv4
      const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
      if (v4Mapped && v4Mapped[1]) {
        return isPrivateIPv4(v4Mapped[1])
      }
      // Unique local: fc00::/7
      if (/^f[c-d]/i.test(ip)) return true
      // Link-local: fe80::/10
      if (/^fe[89ab]/i.test(ip)) return true
      // Multicast: ff00::/8
      if (/^ff/i.test(ip)) return true
      // Documentation: 2001:db8::/32
      if (/^2001:db8:/i.test(ip)) return true
      return false
    }

    // IPv4
    return isPrivateIPv4(ip)
  })
}

/** Resolve hostname to first IP — used to pin DNS at validation time (rebinding SSRF). */
export async function dnsLookup(hostname: string): Promise<string> {
  const addresses = await dnsLookupAll(hostname)
  if (!addresses.length) throw new Error(`DNS lookup failed for ${hostname}`)
  return addresses[0]!
}

async function dnsLookupAll(hostname: string): Promise<string[]> {
  const { resolve } = await import('dns/promises')
  try {
    return await resolve(hostname)
  } catch {
    return []
  }
}

function isPrivateIPv4(ip: string): boolean {
  if (ip.startsWith('0.') || ip === '127.0.0.1') return true
  const parts = ip.split('.').map(Number)
  if (parts.some(isNaN)) return true
  if (parts[0] === 10) return true
  if (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 169 && parts[1] === 254) return true
  // CGNAT 100.64.0.0/10
  if (parts[0] === 100 && (parts[1] ?? 0) >= 64 && (parts[1] ?? 0) <= 127) return true
  // Multicast 224.0.0.0/4
  if ((parts[0] ?? 0) >= 224 && (parts[0] ?? 0) <= 239) return true
  // Reserved 240.0.0.0/4 (includes 255.255.255.255 broadcast)
  if ((parts[0] ?? 0) >= 240) return true
  // Benchmark 198.18.0.0/15
  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true
  return false
}

export async function checkApiKey(providedKey: string | undefined): Promise<boolean> {
  const backendKey = await getBackendApiKey()
  if (!backendKey) return false // fail-closed: production must have API key
  if (!providedKey) return false
  const crypto = await import('crypto')
  const a = Buffer.from(providedKey)
  const b = Buffer.from(backendKey)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export type { SettingCategory }
