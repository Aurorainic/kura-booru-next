/**
 * Auth helpers for endpoints that accept either admin session or extension key.
 * Used by web-import.post.ts and any future extension-facing endpoint.
 */
import type { H3Event } from 'h3'
import { createError } from 'h3'

export function getExtensionKey(event: H3Event): { id: string; name: string; createdBy: string } | null {
  return (event.context as any).extensionKey ?? null
}

export function requireExtensionKey(event: H3Event): { id: string; name: string; createdBy: string } {
  const ctx = getExtensionKey(event)
  if (!ctx) {
    throw createError({ statusCode: 401, statusMessage: 'Extension API key required' })
  }
  return ctx
}

/**
 * Accept either admin session OR extension key. Returns the auth context
 * discriminator so callers can branch (e.g. for rate-limit bucketing).
 */
export async function requireAdminOrExtensionKey(event: H3Event): Promise<
  | { kind: 'admin' }
  | { kind: 'extension'; keyId: string }
> {
  const cookie = getHeader(event, 'cookie') || ''
  if (await getIsAdmin(cookie)) return { kind: 'admin' }
  const ext = getExtensionKey(event)
  if (ext) return { kind: 'extension', keyId: ext.id }
  throw createError({ statusCode: 401, statusMessage: 'Admin session or extension API key required' })
}