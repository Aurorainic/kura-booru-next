import { db } from './db'
import { settings } from '../schema/settings'
import { eq, sql } from 'drizzle-orm'

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

export async function getPublicSettings() {
  const all = await getSettings()
  return {
    site_title: all.site_title || 'Kura Booru',
    site_description: all.site_description || '',
    announcement: all.announcement || '',
    head_inject: all.head_inject || '',
    maintenance_mode: all.maintenance_mode || 'false',
  }
}

export async function updateSettings(updates: Record<string, string>) {
  for (const [key, value] of Object.entries(updates)) {
    await db.insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
  }
  settingsCacheAt = 0 // bust cache
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
  const backendKey = process.env.BACKEND_API_KEY
  if (!backendKey) return false // fail-closed: production must have API key
  if (!providedKey) return false
  const crypto = await import('crypto')
  const a = Buffer.from(providedKey)
  const b = Buffer.from(backendKey)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Validate URL-patterns match[1] / match[2] — null-safe string extraction
export function matchGroup(match: RegExpMatchArray | null, index: number): string {
  return match?.[index] || ''
}
