import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'
import { updateSettings } from '../../../../utils/settings'
import { refreshAiConfig, getAiStatus } from '../../../../lib/ai/config'

/**
 * Global AI tag-processing switch (settings KV key `ai_tag_processing_enabled`).
 * Distinct from per-provider enabled flags: this gates every AI feature at once.
 */
export default defineAdminHandler({
  doc: { method: 'put', path: '/api/admin/ai/toggle', summary: 'Toggle global AI tag processing' },
  handler: async ({ event }) => {
    const body = await readBody<{ enabled?: boolean }>(event)
    if (typeof body?.enabled !== 'boolean') {
      throw new AppError('VALIDATION_FAILED', 400, 'enabled (boolean) required')
    }

    await updateSettings({ ai_tag_processing_enabled: body.enabled ? 'true' : 'false' })
    await refreshAiConfig()

    return { ok: true, tag_processing: body.enabled, status: getAiStatus() }
  },
})
