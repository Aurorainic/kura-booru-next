/**
 * Extension auth middleware — v0.7.8. Recognizes `X-Api-Key` with the `kb_ext_`
 * prefix and attaches `{ id, name, createdBy }` to event.context.extensionKey.
 * Does NOT enforce auth — endpoints opt in via requireExtensionKey(event).
 * Prefix discrimination stays orthogonal to BACKEND_API_KEY; neither queries DB without a header.
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