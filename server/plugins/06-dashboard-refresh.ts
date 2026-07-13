/**
 * Refresh mv_dashboard_stats every 5 minutes.
 *
 * Uses REFRESH MATERIALIZED VIEW CONCURRENTLY — requires the unique index
 * on (id) defined in 0003_dashboard_mv.sql. Stagger refresh on a 5-min
 * boundary-aligned timer; first refresh happens 30s after startup.
 */
import { sql } from 'drizzle-orm'
import { db } from '../utils/db'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const FIRST_REFRESH_DELAY_MS = 30_000

async function refreshDashboardMv() {
  try {
    await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_stats`)
  } catch (err) {
    // ponytail: a failed refresh is not fatal — admin will see stale data,
    // next 5-min tick retries. Don't kill the worker.
    console.warn('[dashboard-mv] refresh failed:', (err as Error).message)
  }
}

export default defineNitroPlugin(() => {
  setTimeout(refreshDashboardMv, FIRST_REFRESH_DELAY_MS)
  setInterval(refreshDashboardMv, REFRESH_INTERVAL_MS)
})
