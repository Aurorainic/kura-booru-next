/**
 * Auth helpers for endpoints that accept either admin session or extension key.
 * Used by web-import.post.ts and any future extension-facing endpoint.
 */
import type { H3Event } from 'h3'
import { createError } from 'h3'

export function getExtensionKey(event: H3Event): { id: string; name: string; createdBy: string; canForceRating: boolean } | null {
  return (event.context as any).extensionKey ?? null
}

/**
 * Accept either admin session OR extension key. Returns the auth context
 * discriminator so callers can branch (rate-limit bucketing, capability
 * checks) without re-reading from event.context.
 */
export async function requireAdminOrExtensionKey(event: H3Event): Promise<
  | { kind: 'admin' }
  | { kind: 'extension'; keyId: string; keyName: string; canForceRating: boolean }
> {
  const cookie = getHeader(event, 'cookie') || ''
  if (await getIsAdmin(cookie)) return { kind: 'admin' }
  const ext = getExtensionKey(event)
  if (ext) {
    return {
      kind: 'extension',
      keyId: ext.id,
      keyName: ext.name,
      canForceRating: ext.canForceRating,
    }
  }
  throw createError({ statusCode: 401, statusMessage: 'Admin session or extension API key required' })
}