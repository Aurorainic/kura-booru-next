/**
 * v0.9.0: load the AI config snapshot from the DB at startup. Sync getAiConfig()
 * callers read the module-level snapshot; admin mutations call refreshAiConfig()
 * again so runtime changes apply without restart. On refresh failure (e.g. migration
 * 0007 not applied) the env fallback stays active — cold start behaves like pre-v0.9.0.
 */

import { refreshAiConfig } from '../lib/ai/config'

export default defineNitroPlugin(async () => {
  await refreshAiConfig()
})
