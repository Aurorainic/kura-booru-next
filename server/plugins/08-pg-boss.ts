/**
 * pg-boss initialization (ADR-0001).
 *
 * Starts pg-boss and registers all named jobs (platform/jobs.ts).
 * pg-boss lives in the existing PG — no new container (hard constraint 4).
 */
import { getBoss, registerJobs } from '../platform/jobs'

export default defineNitroPlugin(() => {
  getBoss()
    .then(async (boss) => {
      console.log('[pg-boss] started')
      await registerJobs(boss)
    })
    .catch(err => console.error('[pg-boss] failed to start:', err))
})
