/**
 * OpenAPI 路由注册表（ADR-0004 §4）。
 *
 * 每个 define*Handler 包装在路由模块求值时把 path/method/auth/schemas 登记到这里，
 * 作为 OpenAPI 文档的唯一数据源。契约冻结的全量 53 端点清单见
 * platform/contract/endpoints.ts（静态、含不可变标注）；本注册表只覆盖已迁移端点。
 */
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'
import type { HandlerSchemas } from '../http/handler'

export type AuthKind = 'public' | 'session' | 'apikey-union' | 'ext-union'

export interface RegisteredRoute {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  path: string
  auth: AuthKind
  summary?: string
  /** 不可变契约标注：extension / bot / image（ADR-0004，源自后端审计 §6 结论） */
  frozen?: 'extension' | 'bot' | 'image'
  schemas?: HandlerSchemas
}

const routes: RegisteredRoute[] = []

export function registerRoute(route: RegisteredRoute): void {
  routes.push(route)
}

export function listRegisteredRoutes(): readonly RegisteredRoute[] {
  return routes
}

/** Nitro 路径参数 :name → OpenAPI {name} */
function toOpenApiPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}')
}

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry()
  for (const route of routes) {
    registry.registerPath({
      method: route.method,
      path: toOpenApiPath(route.path),
      summary: route.summary,
      ...(route.frozen ? { 'x-contract': 'frozen' } : {}),
      request: {
        // zod-to-openapi 要求 params/query 为 ZodObject（其 RouteParameter 类型
        // 未从包入口导出）；契约侧 HandlerSchemas 是宽松 ZodType，传 ZodObject
        // 是调用方责任，这里只做登记层收窄
        ...(route.schemas?.params ? { params: route.schemas.params as any } : {}),
        ...(route.schemas?.query ? { query: route.schemas.query as any } : {}),
        ...(route.schemas?.body
          ? { body: { content: { 'application/json': { schema: route.schemas.body } } } }
          : {}),
      },
      // 出参 schema 随各端点迁移逐步补齐（ADR-0004：以 v0.8.1 diff 录制为准）
      responses: { 200: { description: 'OK' } },
    })
  }
  const generator = new OpenApiGeneratorV31(registry.definitions)
  return generator.generateDocument({
    openapi: '3.1.0',
    info: { title: 'kura-booru API', version: '0.9.0' },
  })
}
