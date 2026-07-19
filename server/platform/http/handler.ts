/**
 * handler 包装核心（ADR-0004 §3）。
 *
 * 所有 define*Handler 共用的骨架：auth → zod 校验 → 业务 handler → 统一错误兜底。
 * 包装层消灭审计 §7.3 确认的样板（session 三行 ×40、apikey 限流块 ×2），
 * 错误统一为 { code, message, details? }（platform/errors.ts）。
 *
 * 注意：query 的值都是字符串，schema 需要 z.coerce / 自行 transform。
 */
import { defineEventHandler, getQuery, getRouterParams, readBody, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import type { ZodType } from 'zod'
import { toErrorResponse } from '../errors'
import { registerRoute, type AuthKind } from '../openapi/registry'

export interface HandlerSchemas {
  body?: ZodType
  query?: ZodType
  params?: ZodType
}

export interface HandlerContext<A, B, Q, P> {
  event: H3Event
  auth: A
  body: B
  query: Q
  params: P
}

export interface RouteDoc {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  path: string
  summary?: string
  frozen?: 'extension' | 'bot' | 'image'
}

export interface WrappedHandlerOptions<A, B, Q, P> {
  authKind: AuthKind
  authenticate: (event: H3Event) => Promise<A>
  schemas?: HandlerSchemas
  doc?: RouteDoc
  handler: (ctx: HandlerContext<A, B, Q, P>) => unknown | Promise<unknown>
}

export function defineWrappedHandler<A = unknown, B = unknown, Q = unknown, P = unknown>(
  opts: WrappedHandlerOptions<A, B, Q, P>,
) {
  if (opts.doc) {
    registerRoute({ ...opts.doc, auth: opts.authKind, schemas: opts.schemas })
  }
  return defineEventHandler(async (event) => {
    try {
      const auth = await opts.authenticate(event)
      const body = opts.schemas?.body
        ? opts.schemas.body.parse(await readBody(event))
        : undefined
      const query = opts.schemas?.query
        ? opts.schemas.query.parse(getQuery(event))
        : getQuery(event)
      const params = opts.schemas?.params
        ? opts.schemas.params.parse(getRouterParams(event))
        : getRouterParams(event)
      return await opts.handler({ event, auth, body: body as B, query: query as Q, params: params as P })
    } catch (e) {
      const { status, body } = toErrorResponse(e)
      setResponseStatus(event, status)
      return body
    }
  })
}
