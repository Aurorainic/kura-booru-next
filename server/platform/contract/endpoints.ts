/**
 * 59 端点契约冻结清单（v0.9.0 规划 阶段 1；后端审计附录 A——规划与审计文档已随仓库清理移除，见 git 历史）。
 *
 * 这是契约的静态真源：路由文件增减/改名必须与这里同步，check.mjs 负责双向漂移守护。
 * frozen 标注三类不可变契约（源自后端审计 §6 结论）：
 *   extension — 浏览器扩展依赖（错误码、状态字面量、响应字段原样保留）
 *   bot       — Telegram webhook 协议（secret_token + callback_data）
 *   image     — /i/ 反代（Range 透传 + 流式 + cache 语义，ADR-0003 保持不变）
 */

export type ContractAuth =
  | 'public' // 匿名可访问（anon 仅 safe 内容）
  | 'session' // cookie session（admin）
  | 'session-or-apikey' // session 或 BACKEND_API_KEY
  | 'ext-union' // session 或 kb_ext_ 扩展 key
  | 'telegram' // x-telegram-bot-api-secret-token

export interface EndpointContract {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  /** 相对 server/routes/ 的路由文件名 */
  file: string
  auth: ContractAuth
  frozen?: 'extension' | 'bot' | 'image'
}

export const ENDPOINT_CONTRACTS: EndpointContract[] = [
  // posts (7)
  { method: 'GET', path: '/api/posts', file: 'api/posts/index.get.ts', auth: 'public' },
  { method: 'GET', path: '/api/posts/:id', file: 'api/posts/[id].get.ts', auth: 'public' },
  { method: 'PATCH', path: '/api/posts/:id', file: 'api/posts/[id].patch.ts', auth: 'session-or-apikey' },
  { method: 'DELETE', path: '/api/posts/:id', file: 'api/posts/[id].delete.ts', auth: 'session' },
  { method: 'PUT', path: '/api/posts/:id/tags', file: 'api/posts/[id]/tags.put.ts', auth: 'session' },
  { method: 'GET', path: '/api/posts/random', file: 'api/posts/random.get.ts', auth: 'public' },
  { method: 'GET', path: '/api/posts/by-source', file: 'api/posts/by-source.get.ts', auth: 'public' },
  // search (1)
  { method: 'GET', path: '/api/search', file: 'api/search/index.get.ts', auth: 'public' },
  // tags (3 — index.get.ts 一个文件服务两条路径)
  { method: 'GET', path: '/api/tags', file: 'api/tags/index.get.ts', auth: 'public' },
  { method: 'GET', path: '/api/tags/:name', file: 'api/tags/index.get.ts', auth: 'public' },
  { method: 'GET', path: '/api/tags/autocomplete', file: 'api/tags/autocomplete.get.ts', auth: 'public' },
  // tasks (4)
  { method: 'POST', path: '/api/tasks', file: 'api/tasks/index.post.ts', auth: 'session-or-apikey' },
  { method: 'POST', path: '/api/tasks/web-import', file: 'api/tasks/web-import.post.ts', auth: 'ext-union', frozen: 'extension' },
  { method: 'GET', path: '/api/tasks/web-import/stream', file: 'api/tasks/web-import/stream.get.ts', auth: 'session' },
  { method: 'GET', path: '/api/tasks/:id', file: 'api/tasks/[id].get.ts', auth: 'session-or-apikey', frozen: 'extension' },
  // admin/ai (6)
  { method: 'POST', path: '/api/admin/ai/chat', file: 'api/admin/ai/chat.post.ts', auth: 'session' },
  { method: 'POST', path: '/api/admin/ai/classify-tags', file: 'api/admin/ai/classify-tags.post.ts', auth: 'session' },
  { method: 'POST', path: '/api/admin/ai/suggest-merges', file: 'api/admin/ai/suggest-merges.post.ts', auth: 'session' },
  { method: 'POST', path: '/api/admin/ai/suggest-ratings', file: 'api/admin/ai/suggest-ratings.post.ts', auth: 'session' },
  { method: 'GET', path: '/api/admin/ai/jobs/:id', file: 'api/admin/ai/jobs/[id].get.ts', auth: 'session' },
  { method: 'GET', path: '/api/admin/ai/status', file: 'api/admin/ai/status.get.ts', auth: 'session' },
  { method: 'PUT', path: '/api/admin/ai/toggle', file: 'api/admin/ai/toggle.put.ts', auth: 'session' },
  // admin/ai/providers (5)
  { method: 'GET', path: '/api/admin/ai/providers', file: 'api/admin/ai/providers/index.get.ts', auth: 'session' },
  { method: 'POST', path: '/api/admin/ai/providers', file: 'api/admin/ai/providers/index.post.ts', auth: 'session' },
  { method: 'PUT', path: '/api/admin/ai/providers/:id', file: 'api/admin/ai/providers/[id].put.ts', auth: 'session' },
  { method: 'DELETE', path: '/api/admin/ai/providers/:id', file: 'api/admin/ai/providers/[id].delete.ts', auth: 'session' },
  { method: 'POST', path: '/api/admin/ai/providers/test', file: 'api/admin/ai/providers/test.post.ts', auth: 'session' },
  // admin/tags (8)
  { method: 'GET', path: '/api/admin/tags', file: 'api/admin/tags/index.get.ts', auth: 'session' },
  { method: 'PATCH', path: '/api/admin/tags/:id', file: 'api/admin/tags/[id].patch.ts', auth: 'session' },
  { method: 'POST', path: '/api/admin/tags/merge', file: 'api/admin/tags/merge.post.ts', auth: 'session' },
  { method: 'POST', path: '/api/admin/tags/reprocess', file: 'api/admin/tags/reprocess.post.ts', auth: 'session' },
  { method: 'POST', path: '/api/admin/tags/fix-artist-categories', file: 'api/admin/tags/fix-artist-categories.post.ts', auth: 'session' },
  { method: 'GET', path: '/api/admin/tags/aliases', file: 'api/admin/tags/aliases/index.get.ts', auth: 'session' },
  { method: 'POST', path: '/api/admin/tags/aliases', file: 'api/admin/tags/aliases.post.ts', auth: 'session' },
  { method: 'DELETE', path: '/api/admin/tags/aliases/:id', file: 'api/admin/tags/aliases/[id].delete.ts', auth: 'session' },
  // admin/dashboard (2)
  { method: 'GET', path: '/api/admin/dashboard', file: 'api/admin/dashboard/index.get.ts', auth: 'session-or-apikey' },
  { method: 'GET', path: '/api/admin/dashboard/system-status', file: 'api/admin/dashboard/system-status.get.ts', auth: 'session' },
  // admin/extension-keys (3)
  { method: 'GET', path: '/api/admin/extension-keys', file: 'api/admin/extension-keys/index.get.ts', auth: 'session' },
  { method: 'POST', path: '/api/admin/extension-keys', file: 'api/admin/extension-keys/index.post.ts', auth: 'session' },
  { method: 'DELETE', path: '/api/admin/extension-keys/:id', file: 'api/admin/extension-keys/[id].delete.ts', auth: 'session' },
  // admin/settings (2)
  { method: 'GET', path: '/api/admin/settings', file: 'api/admin/settings/index.get.ts', auth: 'session' },
  { method: 'PUT', path: '/api/admin/settings', file: 'api/admin/settings/index.put.ts', auth: 'session' },
  // auth (4)
  { method: 'POST', path: '/api/auth/login', file: 'api/auth/login.post.ts', auth: 'public' },
  { method: 'POST', path: '/api/auth/logout', file: 'api/auth/logout.post.ts', auth: 'session' },
  { method: 'GET', path: '/api/auth/status', file: 'api/auth/status.get.ts', auth: 'public' },
  { method: 'POST', path: '/api/auth/change-password', file: 'api/auth/change-password.post.ts', auth: 'session' },
  // settings (5)
  { method: 'GET', path: '/api/settings', file: 'api/settings/index.get.ts', auth: 'session' },
  { method: 'PUT', path: '/api/settings', file: 'api/settings/index.put.ts', auth: 'session' },
  { method: 'GET', path: '/api/settings/public', file: 'api/settings/public.get.ts', auth: 'public' },
  { method: 'POST', path: '/api/settings/test-pg', file: 'api/settings/test-pg.post.ts', auth: 'session' },
  { method: 'POST', path: '/api/settings/test-redis', file: 'api/settings/test-redis.post.ts', auth: 'session' },
  // auto-rating-rules (3)
  { method: 'GET', path: '/api/auto-rating-rules', file: 'api/auto-rating-rules/index.get.ts', auth: 'session' },
  { method: 'POST', path: '/api/auto-rating-rules', file: 'api/auto-rating-rules/index.post.ts', auth: 'session' },
  { method: 'DELETE', path: '/api/auto-rating-rules/:id', file: 'api/auto-rating-rules/[id].delete.ts', auth: 'session' },
  // rebuild (1)
  { method: 'POST', path: '/api/rebuild', file: 'api/rebuild/index.post.ts', auth: 'session-or-apikey' },
  // bot (1)
  { method: 'POST', path: '/bot/webhook', file: 'bot/webhook.post.ts', auth: 'telegram', frozen: 'bot' },
  // 图片反代 (1)
  { method: 'GET', path: '/i/*', file: 'i/[...].ts', auth: 'public', frozen: 'image' },
  // 其他 (2)
  { method: 'GET', path: '/health', file: 'health.get.ts', auth: 'public' },
  { method: 'POST', path: '/logout', file: 'logout.post.ts', auth: 'public' },
]
