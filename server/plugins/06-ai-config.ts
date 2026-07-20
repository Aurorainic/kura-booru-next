/**
 * v0.9.0: load the AI config snapshot from the DB at startup.
 *
 * The sync getAiConfig() callers (pipeline, bot, AI jobs) read a module-level
 * snapshot; this plugin populates it from ai_providers + the settings toggle
 * once the DB is reachable. Admin mutation endpoints call refreshAiConfig()
 * again after writes, so runtime changes take effect without a restart.
 * If the refresh fails (e.g. migration 0007 not applied yet), the env-based
 * fallback snapshot stays active — cold start behaves like pre-v0.9.0.
 */

import { refreshAiConfig } from '../lib/ai/config'

export default defineNitroPlugin(async () => {
  await refreshAiConfig()
})
