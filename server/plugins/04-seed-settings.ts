/**
 * Seed settings from environment variables on first startup.
 * B-P3-11: check if settings table is empty, seed from SITE_TITLE/SITE_DESCRIPTION/MAINTENANCE_MODE.
 */

import { sql } from 'drizzle-orm'
import { db } from '../utils/db'
import { settings } from '../schema/settings'

export default defineNitroPlugin(async () => {
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(settings)
  const count = Number(countResult[0]?.count || 0)
  if (count > 0) return // already seeded

  const seedValues: { key: string; value: string }[] = []
  if (process.env.SITE_TITLE) seedValues.push({ key: 'site_title', value: process.env.SITE_TITLE })
  if (process.env.SITE_DESCRIPTION) seedValues.push({ key: 'site_description', value: process.env.SITE_DESCRIPTION })
  if (process.env.MAINTENANCE_MODE) seedValues.push({ key: 'maintenance_mode', value: process.env.MAINTENANCE_MODE })

  if (seedValues.length === 0) return

  await db.insert(settings).values(seedValues).onConflictDoNothing()
  console.log('[seed-settings] Seeded from env:', seedValues.map(s => s.key).join(', '))
})
