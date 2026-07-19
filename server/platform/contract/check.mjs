#!/usr/bin/env node
/**
 * 契约漂移守护（plan.md §阶段 1：API 契约测试基线）。
 *
 * 双向比对 server/routes/ 路由文件与 platform/contract/endpoints.ts 冻结清单：
 *   A. 每个路由文件必须出现在契约清单中（新增端点 = 更新清单，强制显式决策）
 *   B. 清单中每条契约的文件必须存在（防清单腐化）
 *   C. 路由文件推导出的 (method, path) 必须与清单一致（防 method/路径改名漂移）
 *   D. 清单内 method+path 不允许重复
 *
 * 运行：node server/platform/contract/check.mjs（npm run test:contract）
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENDPOINT_CONTRACTS } from './endpoints.ts'

const routesDir = fileURLToPath(new URL('../../routes', import.meta.url))

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 路由文件名 → (method, path)。Nitro 约定：index 省略、[id] → :id、[...] → * */
function derive(file) {
  const rel = relative(routesDir, file).replaceAll('\\', '/')
  const base = rel.replace(/\.ts$/, '')
  const m = base.match(/\.(get|post|put|patch|delete)$/)
  const method = (m ? m[1] : 'get').toUpperCase()
  const noMethod = m ? base.slice(0, -m[0].length) : base
  const segments = noMethod
    .split('/')
    .filter((s) => s && s !== 'index')
    .map((s) => (s === '[...]' ? '*' : s.replace(/^\[(.+)\]$/, ':$1')))
  return { method, path: '/' + segments.join('/'), file: rel }
}

const files = walk(routesDir).map(derive)
const errors = []

// D. 清单内部重复
const seen = new Map()
for (const c of ENDPOINT_CONTRACTS) {
  const key = `${c.method} ${c.path}`
  if (seen.has(key)) errors.push(`契约清单重复: ${key} (${seen.get(key)} 与 ${c.file})`)
  seen.set(key, c.file)
}

// B. 契约 → 文件存在
for (const c of ENDPOINT_CONTRACTS) {
  if (!files.some((f) => f.file === c.file)) {
    errors.push(`契约指向不存在的路由文件: ${c.method} ${c.path} → ${c.file}`)
  }
}

// A + C. 文件 → 契约（method/path 推导一致）
for (const f of files) {
  const entries = ENDPOINT_CONTRACTS.filter((c) => c.file === f.file)
  if (entries.length === 0) {
    errors.push(`路由文件未登记进契约清单: ${f.file}（推导为 ${f.method} ${f.path}）`)
    continue
  }
  if (!entries.some((c) => c.method === f.method && c.path === f.path)) {
    errors.push(
      `路由文件与契约不一致: ${f.file} 推导为 ${f.method} ${f.path}，清单中为 ` +
        entries.map((c) => `${c.method} ${c.path}`).join(', '),
    )
  }
}

if (errors.length) {
  console.error(`契约漂移检测失败（${errors.length} 项）：`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log(`契约冻结校验通过：${files.length} 个路由文件 / ${ENDPOINT_CONTRACTS.length} 条端点契约`)
