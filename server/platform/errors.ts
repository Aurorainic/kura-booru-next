/**
 * 统一错误形状（ADR-0004）：{ code, message, details? }
 *
 * - `code` 是唯一契约面：前端/扩展/bot 只匹配 code，不匹配 message。
 * - 扩展依赖的字面错误码（如 key_not_authorized_for_force_rating）原样作为 code 值保留。
 * - utils 层的两种历史方言（Object.assign(new Error, {statusCode}) 与裸 Error + 自制 code）
 *   由 toErrorResponse 兜底转换，迁移期内旧 throw 点也能得到统一形状。
 */
import { ZodError } from 'zod'

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code)
    this.name = 'AppError'
  }
}

export interface ErrorBody {
  code: string
  message: string
  details?: unknown
}

const STATUS_DEFAULT_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
}

/** h3 createError 的历史 throw 点经这里映射进统一形状。 */
export function toErrorResponse(e: unknown): { status: number; body: ErrorBody } {
  if (e instanceof AppError) {
    return {
      status: e.statusCode,
      body: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) },
    }
  }
  if (e instanceof ZodError) {
    return {
      status: 400,
      body: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    }
  }
  const anyErr = e as { statusCode?: number; statusMessage?: string; message?: string } | null
  const status = typeof anyErr?.statusCode === 'number' ? anyErr.statusCode : 500
  if (status >= 500) {
    // 5xx 不外泄内部信息；日志保留原始错误
    console.error('[error]', e)
    return { status, body: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }
  }
  return {
    status,
    body: {
      code: STATUS_DEFAULT_CODE[status] ?? 'ERROR',
      message: anyErr?.statusMessage ?? anyErr?.message ?? 'Error',
    },
  }
}
