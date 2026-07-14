/**
 * Extension auth middleware — v0.7.8.
 *
 * Recognizes API requests carrying `X-Api-Key` with the `kb_ext_` prefix
 * and attaches `{ id, name, createdBy }` to `event.context.extensionKey`.
 * Does NOT enforce auth — individual endpoints opt in via
 * `requireExtensionKey(event)` (or rely on session auth as alternative).
 *
 * Prefix discrimination keeps this layer fully orthogonal to BACKEND_API_KEY
 * (handled by `checkApiKey` in settings.ts). Neither path queries DB unless
 * a relevant header is present.
 */
import { EXT_KEY_PREFIX, verifyExtensionKey } from '../utils/extension-auth'

export default defineEventHandler(async (event) => {
  const key = getRequestHeader(event, 'x-api-key')
  if (!key || !key.startsWith(EXT_KEY_PREFIX)) return

  const ctx = await verifyExtensionKey(key)
  if (ctx) {
    event.context.extensionKey = ctx
  }
})