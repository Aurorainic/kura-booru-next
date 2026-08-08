import { defineAdminHandler } from '../../../../platform/http/auth'
import { AppError } from '../../../../platform/errors'
import { updateSettings } from '../../../../utils/settings'
import { SETTING_DEF_MAP, validateSettingValue } from '../../../../utils/settings-defs'

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
    // H9: 按 def.type 校验类型/枚举/长度 — 防止 '<script>'、'yes' 等脏值落库。
    const filtered: Record<string, string> = {}
    for (const [key, value] of Object.entries(settings)) {
      if (!WRITABLE_KEYS.has(key)) continue
      const def = SETTING_DEF_MAP[key]
      if (!def) continue
      try {
        filtered[key] = validateSettingValue(def, String(value))
      } catch (e) {
        throw new AppError('INVALID_SETTING', 400, `${key}: ${(e as Error).message}`)
      }
    }

    if (Object.keys(filtered).length === 0) {
      throw new AppError('VALIDATION_FAILED', 400, 'no writable settings provided')
    }

    await updateSettings(filtered)
    return { ok: true }
  },
})
