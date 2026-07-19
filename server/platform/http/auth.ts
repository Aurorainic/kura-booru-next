/**
 * 四种 auth 包装（ADR-0004 §3）。
 *
 * - defineAdminHandler：cookie session（消灭 §7.3 的三行样板 ×40）
 * - defineApiKeyHandler：session 或 BACKEND_API_KEY 二选一；api-key 路径统一
 *   30/min/IP 限流 + 审计日志（消灭 posts/[id].patch.ts:32-41 与
 *   dashboard/index.get.ts:16-25 的逐字重复块）
 * - defineExtHandler：session 或 kb_ext_ 扩展 key 联合判别 + per-key 60/min
 *   （web-import 模式的一般化）
 * - definePublicHandler：无鉴权，仅校验 + 错误兜底
 */
import { getHeader, getRequestIP } from 'h3'
import type { H3Event } from 'h3'
import { AppError } from '../errors'
import { defineWrappedHandler, type HandlerSchemas, type RouteDoc, type HandlerContext } from './handler'
import { getIsAdmin } from '../../utils/auth'
import { checkApiKey } from '../../utils/settings'
import { requireAdminOrExtensionKey } from '../../utils/auth-helpers'
import { rateLimit } from '../../utils/rate-limit'
import { redis } from '../../utils/redis'

export interface AdminAuth {
  kind: 'admin'
}
export interface ApiKeyUnionAuth {
  kind: 'admin' | 'apikey'
}
export type ExtUnionAuth =
  | { kind: 'admin' }
  | { kind: 'extension'; keyId: string; keyName: string; canForceRating: boolean }
export interface PublicAuth {
  kind: 'public'
}

interface CommonOptions<S extends HandlerSchemas | undefined> {
  schemas?: S
  doc?: RouteDoc
}

type Ctx<A, S extends HandlerSchemas | undefined> = HandlerContext<
  A,
  S extends HandlerSchemas ? (S['body'] extends import('zod').ZodType<infer B> ? B : unknown) : unknown,
  S extends HandlerSchemas ? (S['query'] extends import('zod').ZodType<infer Q> ? Q : unknown) : unknown,
  S extends HandlerSchemas ? (S['params'] extends import('zod').ZodType<infer P> ? P : unknown) : unknown
>

async function requireAdmin(event: H3Event): Promise<AdminAuth> {
  const cookie = getHeader(event, 'cookie') || ''
  if (await getIsAdmin(cookie)) return { kind: 'admin' }
  throw new AppError('ADMIN_REQUIRED', 401, 'Admin required')
}

export function defineAdminHandler<S extends HandlerSchemas | undefined = undefined>(
  opts: CommonOptions<S> & { handler: (ctx: Ctx<AdminAuth, S>) => unknown | Promise<unknown> },
) {
  return defineWrappedHandler({ authKind: 'session', authenticate: requireAdmin, ...opts })
}

/** api-key 路径的限流/审计参数，与原两处置实现保持一致（§7.3）。 */
const API_KEY_RATE_LIMIT = 30
const API_KEY_RATE_WINDOW_SEC = 60

function requireAdminOrApiKey(auditAction: string) {
  return async (event: H3Event): Promise<ApiKeyUnionAuth> => {
    const cookie = getHeader(event, 'cookie') || ''
    if (await getIsAdmin(cookie)) return { kind: 'admin' }
    const apiKey = getHeader(event, 'x-api-key')
    if (!(await checkApiKey(apiKey))) {
      throw new AppError('UNAUTHORIZED', 401, 'Unauthorized')
    }
    // API-key callers get rate-limited + audit-logged; admin sessions skip both.
    const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
    const rlKey = `apikey:rate:${ip}`
    const count = await redis.incr(rlKey)
    if (count === 1) await redis.expire(rlKey, API_KEY_RATE_WINDOW_SEC)
    if (count > API_KEY_RATE_LIMIT) {
      throw new AppError('RATE_LIMITED', 429, 'Rate limit exceeded')
    }
    console.warn(`[audit] api-key ${auditAction}`, { ip })
    return { kind: 'apikey' }
  }
}

export function defineApiKeyHandler<S extends HandlerSchemas | undefined = undefined>(
  opts: CommonOptions<S> & {
    /** 审计日志动作名，如 "rating mutation" / "dashboard read" */
    auditAction: string
    handler: (ctx: Ctx<ApiKeyUnionAuth, S>) => unknown | Promise<unknown>
  },
) {
  const { auditAction, ...rest } = opts
  return defineWrappedHandler({ authKind: 'apikey-union', authenticate: requireAdminOrApiKey(auditAction), ...rest })
}

async function requireAdminOrExtKey(event: H3Event): Promise<ExtUnionAuth> {
  // requireAdminOrExtensionKey 抛 h3 createError(401)，由 toErrorResponse 统一形状
  const auth = await requireAdminOrExtensionKey(event)
  if (auth.kind === 'extension') {
    // Per-key throttle: extension users capped at 60 imports/min; admin session unmetered.
    const rl = await rateLimit(`ext:${auth.keyId}`, 60, 60)
    if (!rl.ok) {
      throw new AppError('RATE_LIMITED', 429, `Rate limit exceeded. Resets in ${rl.resetSec}s.`)
    }
  }
  return auth
}

export function defineExtHandler<S extends HandlerSchemas | undefined = undefined>(
  opts: CommonOptions<S> & { handler: (ctx: Ctx<ExtUnionAuth, S>) => unknown | Promise<unknown> },
) {
  return defineWrappedHandler({ authKind: 'ext-union', authenticate: requireAdminOrExtKey, ...opts })
}

export function definePublicHandler<S extends HandlerSchemas | undefined = undefined>(
  opts: CommonOptions<S> & { handler: (ctx: Ctx<PublicAuth, S>) => unknown | Promise<unknown> },
) {
  return defineWrappedHandler({
    authKind: 'public',
    authenticate: async () => ({ kind: 'public' as const }),
    ...opts,
  })
}
