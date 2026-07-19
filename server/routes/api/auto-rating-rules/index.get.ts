import { defineAdminHandler } from '../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'get', path: '/api/auto-rating-rules', summary: 'List auto-rating rules' },
  handler: async () => {
    const rules = await db.select().from(autoRatingRules).orderBy(autoRatingRules.tagName)
    return rules.map(serializeAutoRatingRule)
  },
})
