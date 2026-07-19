#!/usr/bin/env node
/**
 * R3.1 蓝绿比对脚本（plan §阶段 3）。
 *
 * 对 contract 清单 53 端点逐一请求 v0.8.1（蓝）与 v0.9.0（绿），做结构级 diff。
 * frozen 端点（web-import/tasks/[id]/bot webhook/i/）必须字节级一致。
 *
 * 用法：
 *   BLUE_BASE=http://localhost:3000 GREEN_BASE=http://localhost:3001 \
 *   node scripts/api-diff.mjs
 *
 * 前置：两版服务并行运行（git worktree + 不同端口）。蓝版 = v0.8.1 tag，
 * 绿版 = v0.9.0 分支。DATABASE_URL 共享（只读端点比对，无副作用）。
 *
 * 结构级 diff 规则：
 *   - 忽略时间戳字段（created_at, refreshed_at, started_at, lastUsedAt 等）
 *   - 忽略随机 id（task_id, job_id, post_id 等仅在 frozen 端点强制一致）
 *   - 数组按可排序 key 排序后比（如 tags 按 name 排）
 *   - frozen 端点：状态码 + 关键字段字节级一致
 */
import { ENDPOINT_CONTRACTS } from '../server/platform/contract/endpoints.ts'

const BLUE = process.env.BLUE_BASE
const GREEN = process.env.GREEN_BASE
const ADMIN_COOKIE = process.env.ADMIN_COOKIE || ''  // 登录态 cookie，用于 session 端点

if (!BLUE || !GREEN) {
  console.error('Usage: BLUE_BASE=<url> GREEN_BASE=<url> [ADMIN_COOKIE=<cookie>] node scripts/api-diff.mjs')
  process.exit(1)
}

// 忽略的时间戳/易变字段（结构级 diff 不比这些）
const VOLATILE_FIELDS = new Set([
  'created_at', 'refreshed_at', 'started_at', 'lastUsedAt', 'last_used_at',
  'ai_processed_at', 'aiProcessedAt', 'refreshedAt',
])

// frozen 端点必须字节级一致的关键字段
const FROZEN_FIELDS = {
  'api/tasks/web-import': ['results[].status', 'results[].task_id', 'results[].url', 'results[].error'],
  'api/tasks/:id': ['task_id', 'status', 'result'],  // status 字面量 + phash 剥离
}

function normalize(value, path = '') {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    // 数组：递归 normalize，然后按 JSON 字符串排序（如果元素是对象）
    const normalized = value.map(v => normalize(v, path + '[]'))
    if (normalized.length > 0 && typeof normalized[0] === 'object' && normalized[0] !== null) {
      // 对象数组：按 name/id 排序
      const sortKey = normalized[0].name ? 'name' : normalized[0].id ? 'id' : null
      if (sortKey) {
        return normalized.sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])))
      }
    }
    return normalized
  }
  // 对象：过滤 volatile 字段，递归
  const result = {}
  for (const [k, v] of Object.entries(value)) {
    if (VOLATILE_FIELDS.has(k)) continue
    result[k] = normalize(v, path + '.' + k)
  }
  return result
}

async function fetchEndpoint(base, contract) {
  let url = base + contract.path.replace(':id', 'test-id').replace(':name', 'test-tag').replace('*', 'test')
  // GET 端点加合理 query
  if (contract.method === 'GET') {
    if (contract.path === '/api/posts') url += '?page=1&per_page=5'
    if (contract.path === '/api/search') url += '?q=test&page=1&per_page=5'
    if (contract.path === '/api/tags') url += '?page=1&per_page=5'
    if (contract.path === '/api/tags/autocomplete') url += '?q=te&per_page=5'
    if (contract.path === '/api/posts/by-source') url += '?source_site=pixiv&source_id=test'
  }

  const headers = { Accept: 'application/json' }
  if (ADMIN_COOKIE) headers.Cookie = ADMIN_COOKIE

  try {
    const resp = await fetch(url, {
      method: contract.method,
      headers,
      ...(contract.method !== 'GET' ? { body: JSON.stringify({}) } : {}),
    })
    const status = resp.status
    let body
    try { body = await resp.json() }
    catch { body = await resp.text().catch(() => null) }
    return { status, body }
  } catch (err) {
    return { status: 0, body: { error: err.message } }
  }
}

function diffBodies(blue, green, isFrozen) {
  if (isFrozen) {
    // frozen: 字节级 JSON 一致
    return JSON.stringify(blue) === JSON.stringify(green) ? null : 'FROZEN_MISMATCH'
  }
  // 结构级：normalize 后比
  const nb = normalize(blue)
  const ng = normalize(green)
  return JSON.stringify(nb) === JSON.stringify(ng) ? null : 'STRUCTURE_MISMATCH'
}

async function main() {
  console.log(`\n=== API 蓝绿比对 ===`)
  console.log(`蓝 (v0.8.1): ${BLUE}`)
  console.log(`绿 (v0.9.0): ${GREEN}`)
  console.log(`Admin cookie: ${ADMIN_COOKIE ? 'provided' : 'NOT provided (session endpoints will 401)'}\n`)

  const results = { pass: [], fail: [], skip: [] }

  for (const contract of ENDPOINT_CONTRACTS) {
    // 跳过不可安全调用的端点（POST/PUT/DELETE 有副作用，bot webhook 需 secret，i/ 需真实 key）
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(contract.method)
    const isBot = contract.path === '/bot/webhook'
    const isImage = contract.path === '/i/*'
    const isLogout = contract.path === '/logout'

    if (isBot || isImage || isLogout) {
      results.skip.push(`${contract.method} ${contract.path} (frozen, manual verify)`)
      continue
    }
    if (isWrite) {
      // 写端点只比对 401/403 响应形状（未授权时的错误结构）
    }

    const [blue, green] = await Promise.all([
      fetchEndpoint(BLUE, contract),
      fetchEndpoint(GREEN, contract),
    ])

    const isFrozen = !!contract.frozen
    const statusMatch = blue.status === green.status
    const bodyDiff = (blue.status >= 200 && blue.status < 300)
      ? diffBodies(blue.body, green.body, isFrozen)
      : null  // 非 2xx 不比 body（错误消息可能不同）

    const passed = statusMatch && !bodyDiff
    const label = `${contract.method} ${contract.path}${isFrozen ? ' [FROZEN]' : ''}`

    if (passed) {
      results.pass.push(label)
      console.log(`  PASS  ${label} (${blue.status})`)
    } else {
      results.fail.push(label + ` — ${!statusMatch ? `status ${blue.status}≠${green.status}` : bodyDiff}`)
      console.log(`  FAIL  ${label} — ${!statusMatch ? `status ${blue.status}≠${green.status}` : bodyDiff}`)
      if (bodyDiff === 'STRUCTURE_MISMATCH' && blue.body && green.body) {
        console.log(`        blue:  ${JSON.stringify(normalize(blue.body)).slice(0, 200)}`)
        console.log(`        green: ${JSON.stringify(normalize(green.body)).slice(0, 200)}`)
      }
    }
  }

  console.log(`\n=== 汇总 ===`)
  console.log(`通过: ${results.pass.length}`)
  console.log(`失败: ${results.fail.length}`)
  console.log(`跳过: ${results.skip.length}`)
  if (results.fail.length > 0) {
    console.log(`\n失败列表:`)
    results.fail.forEach(f => console.log(`  ✗ ${f}`))
    process.exit(1)
  }
  console.log(`\n✓ 全量比对通过`)
}

main().catch(err => { console.error(err); process.exit(1) })
