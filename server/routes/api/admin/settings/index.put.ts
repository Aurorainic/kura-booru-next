import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'
import { updateSettings } from '../../../../utils/settings'
import { SETTING_DEF_MAP } from '../../../../utils/settings-defs'

// 允许写入的键 = 注册表内全部非 readonly 键（secret 项空串=保持原值）。
// readonly 项（infra/admin）由 env 提供，后台不可写。
const WRITABLE_KEYS = new Set(
  Object.values(SETTING_DEF_MAP)
    .filter(d => d.type !== 'readonly')
    .map(d => d.key),
)

export default defineAdminHandler({
  doc: { method: 'put', path: '/api/admin/settings', summary: 'Update admin settings (hot reload)' },
  handler: async ({ event }) => {
    const body = await readBody(event)
    const settings = body.settings as Record<string, string> | undefined

    if (!settings || typeof settings !== 'object') {
      throw new AppError('VALIDATION_FAILED', 400, 'settings object required')
    }

    // 只接受注册表内的可写键；secret 键空串会被 updateSettings 忽略（保持原值）。
    const filtered: Record<string, string> = {}
    for (const [key, value] of Object.entries(settings)) {
      if (WRITABLE_KEYS.has(key)) {
        filtered[key] = String(value)
      }
    }

    if (Object.keys(filtered).length === 0) {
      throw new AppError('VALIDATION_FAILED', 400, 'no writable settings provided')
    }

    await updateSettings(filtered)
    return { ok: true }
  },
})
