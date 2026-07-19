// pg-boss spike for plan.md §B4 — verifies the three decision inputs:
//   1. enqueue/consume with FOR UPDATE SKIP LOCKED (concurrent workers, exactly-once)
//   2. cron schedules (equivalents of dashboard-refresh 5min / sync-tasks 1h)
//   3. retry with backoff + dead-letter queue
// Python sidecar consumption is explicitly OUT of scope (known infeasible —
// pg-boss is Node-only; the kura:jobs Redis bridge to sidecar stays).
//
// Run: docker compose up -d && npm install && node demo.mjs
import { PgBoss } from 'pg-boss'

// cronMonitorIntervalSeconds default is 30 — fine for 5min/1h production cadences,
// but too coarse for the 10s demo schedule, so tighten it here.
const boss = new PgBoss({
  connectionString: 'postgres://spike:spike@127.0.0.1:54329/pgboss_spike',
  cronMonitorIntervalSeconds: 2,
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = { pass: [], fail: [] }
const check = (name, cond, detail = '') => {
  results[cond ? 'pass' : 'fail'].push(`${name}${detail ? ' — ' + detail : ''}`)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

async function waitFor(cond, timeoutMs, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await cond()) return true
    await sleep(250)
  }
  throw new Error(`timeout waiting for: ${label}`)
}

await boss.start()
console.log(`pg-boss started, schema version: ${await boss.schemaVersion()}\n`)

// ── 1. enqueue/consume, SKIP LOCKED exactly-once under concurrency ──────────
{
  await boss.createQueue('import-job')
  const seen = new Map() // jobId -> workerId
  let duplicates = 0
  for (const w of ['worker-A', 'worker-B', 'worker-C']) {
    await boss.work('import-job', async ([job]) => {
      if (seen.has(job.id)) duplicates++
      seen.set(job.id, w)
      await sleep(30) // simulate work so fetches overlap
    })
  }
  const ids = []
  for (let i = 0; i < 12; i++) ids.push(await boss.send('import-job', { n: i }))
  check('enqueue returns job ids', ids.every(Boolean), `${ids.length} jobs queued`)
  await waitFor(() => seen.size === 12, 15000, '12 jobs consumed')
  check('exactly-once under 3 concurrent workers (SKIP LOCKED)', duplicates === 0 && seen.size === 12,
    `12 jobs, ${duplicates} duplicates, distribution: ${JSON.stringify([...seen.values()].reduce((a, w) => (a[w] = (a[w] || 0) + 1, a), {}))}`)
  await boss.offWork('import-job')
}

// ── 2. cron schedules ────────────────────────────────────────────────────────
{
  // dashboard-refresh equivalent: production '*/5 * * * *' → demo every minute.
  // NOTE: pg-boss throttles cron sends with singletonSeconds=60 (timekeeper.js),
  // so sub-minute schedules are clamped to ~1/min — finest useful cadence is 1min.
  await boss.createQueue('dashboard-refresh')
  await boss.schedule('dashboard-refresh', '* * * * *', { mv: 'mv_dashboard_stats' })
  // sync-tasks equivalent: production '0 * * * *' hourly — register only
  await boss.createQueue('sync-tasks')
  await boss.schedule('sync-tasks', '0 * * * *', { reconcile: 'tag post_count' })

  const schedules = await boss.getSchedules()
  check('schedules registered', schedules.length === 2,
    schedules.map((s) => `${s.name}=${s.cron}`).join(', '))

  let fires = 0
  const firedAt = []
  await boss.work('dashboard-refresh', async () => { fires++; firedAt.push(new Date().toISOString()) })
  await waitFor(() => fires >= 2, 150000, '2 cron fires')
  check('cron fires repeatedly (1min demo cadence)', fires >= 2, `${fires} fires at ${firedAt.join(', ')}`)
  await boss.unschedule('dashboard-refresh')
  await boss.unschedule('sync-tasks')
  await boss.offWork('dashboard-refresh')
}

// ── 3. retry with backoff + dead-letter queue ────────────────────────────────
{
  // dead-letter queue must exist before it is referenced
  await boss.createQueue('fragile-dlq')
  await boss.createQueue('fragile', {
    retryLimit: 2, retryDelay: 1, retryBackoff: true, deadLetter: 'fragile-dlq',
  })
  // clean slate: previous demo runs may have left dead jobs behind
  await boss.deleteAllJobs('fragile')
  await boss.deleteAllJobs('fragile-dlq')
  let attempts = 0
  await boss.work('fragile', async () => { attempts++; throw new Error(`boom #${attempts}`) })
  // NOTE: v12 dead-lettering COPIES the job into the DLQ with a NEW id (the
  // original stays 'failed' in the source queue); payload is preserved, so
  // correlate via a marker in data, not via job id.
  const marker = crypto.randomUUID()
  await boss.send('fragile', { url: 'https://example.invalid/x', marker })
  await waitFor(() => attempts >= 3, 20000, '3 attempts (1 initial + 2 retries)')
  check('retries exhausted: 1 initial + retryLimit 2', attempts === 3, `attempts=${attempts}`)

  const inDlq = async () => (await boss.findJobs('fragile-dlq', {})).some((j) => j.data?.marker === marker)
  await waitFor(inDlq, 15000, 'job in DLQ')
  check('dead-lettered after retries (new id, payload preserved)', await inDlq(), 'dlq job carries marker')

  // redrive: pull the dead job back for another shot (ops story for DLQ)
  const redriven = await boss.redrive('fragile-dlq')
  check('DLQ redrive supported', redriven === 1, `redrive() moved ${redriven} job back`)
  await boss.offWork('fragile')
}

await boss.stop({ graceful: true })
console.log(`\n=== SUMMARY: ${results.pass.length} passed, ${results.fail.length} failed ===`)
process.exit(results.fail.length ? 1 : 0)
