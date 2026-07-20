import crypto from 'crypto'
import bcryptjs from 'bcryptjs'
import { eq } from 'drizzle-orm'

// Seed default admin on startup if none exists.
// B-P3-12: Generate random password if ADMIN_PASSWORD not set, print to logs.
export default defineNitroPlugin(async () => {
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
  let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

  // Generate random password if not set
  if (!ADMIN_PASSWORD) {
    ADMIN_PASSWORD = crypto.randomBytes(16).toString('hex')
    console.warn('[seed-admin] ============================================')
    console.warn(`[seed-admin] ADMIN_PASSWORD not set — generated: ${ADMIN_PASSWORD}`)
    console.warn('[seed-admin] Save this password or set ADMIN_PASSWORD in .env')
    console.warn('[seed-admin] ============================================')
  }

  const existing = await db.select().from(admins).where(eq(admins.username, ADMIN_USERNAME)).limit(1)
  if (existing[0]) return // admin already exists

  const hash = await bcryptjs.hash(ADMIN_PASSWORD, 12)
  await db.insert(admins).values({ username: ADMIN_USERNAME, passwordHash: hash })
  console.log(`[seed-admin] Created default admin "${ADMIN_USERNAME}"`)
})
