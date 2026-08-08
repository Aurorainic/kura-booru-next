/**
 * 全站设置定义注册表（v0.10.0）。
 *
 * 定义后台可维护的全部设置项：分类、类型、标签、描述、是否公开、是否敏感。
 * DB 侧仍是 settings 键值表，这里提供渲染与校验所需的元数据。
 *
 * 分类（后台 7 类卡片）：
 *   site       站点       — 标题/描述/URL/公告/head 注入/维护模式
 *   images     图片       — 缩略图/预览/上传大小
 *   storage    存储       — S3 六项
 *   bot        机器人     — token/webhook secret/管理员 ID/中转代理
 *   integrations 集成    — Pixiv / Backend API Key
 *   infra      基础设施   — DATABASE_URL / REDIS_URL（只读展示 + 测试）
 *   admin      管理员     — 账号密码（独立 PasswordPanel 管理，此处只读说明）
 *
 * secret=true 的项在后台掩码显示、保存后不回显明文、public 恒为 false。
 */

export type SettingType = 'text' | 'textarea' | 'number' | 'boolean' | 'secret' | 'select' | 'readonly'
export type SettingCategory = 'site' | 'images' | 'storage' | 'bot' | 'integrations' | 'infra' | 'admin'

export interface SettingDef {
  key: string
  category: SettingCategory
  type: SettingType
  label: string
  description?: string
  /** 是否出现在公开 /api/settings/public 响应中 */
  public?: boolean
  /** 敏感值：后台掩码、保存后不回显明文 */
  secret?: boolean
  /** 是否渲染在后台「站点设置」卡片中（默认 true；AI 开关由「AI 设置」面板专用，隐藏避免双入口） */
  adminPanel?: boolean
  /** 默认值（DB 无记录时使用） */
  default?: string
  /** 由 env 迁移时的初始值（seed 时优先于 default） */
  env?: string
  placeholder?: string
  /** select 类型的候选项（value → 显示文案） */
  options?: { value: string; label: string }[]
  /** readonly 项的说明（如基础设施卡） */
  note?: string
}

export const SETTING_DEFS: SettingDef[] = [
  // ── 站点 ──
  { key: 'run_mode', category: 'site', type: 'select', label: '运行模式', description: 'intranet（内网）：所有访客视为管理员，无需登录，所有评级可见，维护模式不生效——仅限可信内网使用；public（公网）：保留登录墙与评级限制，维护模式正常拦截。默认 public，内网模式需手动选择。', default: 'public', options: [
    { value: 'public', label: '公网模式（登录墙 + 评级限制，默认）' },
    { value: 'intranet', label: '内网模式（无需登录，所有内容可见）' },
  ] },
  { key: 'site_title', category: 'site', type: 'text', label: '站点标题', description: '显示在浏览器标签与页面头部。', public: true, default: 'Kura Booru', env: 'SITE_TITLE' },
  { key: 'site_description', category: 'site', type: 'text', label: '站点描述', description: '首页 meta description。', public: true, default: '', env: 'SITE_DESCRIPTION' },
  { key: 'site_url', category: 'site', type: 'text', label: '站点 URL', description: '对外访问地址，用于 CORS、Webhook、分享链接与站内回调。', public: false, default: 'http://localhost:3000', env: 'SITE_URL', placeholder: 'https://example.com' },
  { key: 'announcement', category: 'site', type: 'textarea', label: '公告内容', description: '支持 Markdown。多行轮播，溢出水平滚动。', public: true, default: '' },
  { key: 'head_inject', category: 'site', type: 'textarea', label: 'Head 注入', description: '注入到 <head> 的 HTML（如分析脚本）。', public: true, default: '' },
  { key: 'maintenance_mode', category: 'site', type: 'boolean', label: '维护模式', description: '开启后非管理员将被重定向到维护页面。', public: true, default: 'false' },
  // ponytail: AI 全局开关加入注册表（site 分类）。此前该 key 只被
  // toggle.put 通过 updateSettings 写入，但 updateSettings 只接受注册表内的 key，
  // 导致 AI 开关永远写不进 DB（刷新后仍保持旧值）。加入后 toggle 才能真正落库，
  // 并随热刷新联动 worker 注册。「AI 设置」面板与「站点设置」卡片均可维护同一值。
  { key: 'ai_tag_processing_enabled', category: 'site', type: 'boolean', label: '启用 AI 标签处理', description: '全局 AI 开关，由「AI 设置」面板维护。', default: 'false', adminPanel: false },
  { key: 'safe_mode_enabled', category: 'site', type: 'boolean', label: '安全模式', description: '开启后列表/随机接口仅返回 safe 评级，搜索/详情返回全部评级但追加 is_blurred。', public: false, default: 'false' },
  { key: 'safe_mode_in_intranet', category: 'site', type: 'boolean', label: '内网模式下启用安全模式', description: '运行模式为 intranet 时强制启用安全模式。', public: false, default: 'false' },

  // ── 图片 ──
  { key: 'thumb_size', category: 'images', type: 'number', label: '缩略图边长 (px)', description: '方形缩略图的最大边长（300w 档）。', default: '300', env: 'THUMB_SIZE', placeholder: '300' },
  { key: 'preview_size', category: 'images', type: 'number', label: '预览图边长 (px)', description: '预览图最大边长（1280w 档）。', default: '1280', env: 'PREVIEW_SIZE', placeholder: '1280' },
  { key: 'max_image_size', category: 'images', type: 'number', label: '上传大小上限 (字节)', description: '0 = 不限制。超过的文件会被拒绝。', default: '0', env: 'MAX_IMAGE_SIZE', placeholder: '0' },

  // ── 存储 (S3) ──
  { key: 's3_region', category: 'storage', type: 'text', label: 'S3 Region', description: 'S3 兼容存储的区域（R2 填 auto）。', default: 'auto', env: 'S3_REGION' },
  { key: 's3_endpoint', category: 'storage', type: 'text', label: 'S3 Endpoint', description: 'S3 兼容存储的 API 地址（R2 填 r2.cloudflarestorage.com）。', default: '', env: 'S3_ENDPOINT', placeholder: 'https://xxx.r2.cloudflarestorage.com' },
  { key: 's3_access_key', category: 'storage', type: 'secret', label: 'S3 Access Key', description: 'S3 访问密钥 ID。', default: '', env: 'S3_ACCESS_KEY' },
  { key: 's3_secret_key', category: 'storage', type: 'secret', label: 'S3 Secret Key', description: 'S3 秘密访问密钥。', default: '', env: 'S3_SECRET_KEY' },
  { key: 's3_bucket', category: 'storage', type: 'text', label: 'S3 Bucket', description: '存储桶名称。', default: 'kura-booru', env: 'S3_BUCKET' },
  { key: 's3_external_url', category: 'storage', type: 'text', label: 'S3 对外 URL', description: '对象存储的公网访问前缀（CDN 域名），图片经此直出；留空则走站内 /i/ 代理。', default: '', env: 'S3_EXTERNAL_URL', placeholder: 'https://cdn.example.com' },

  // ── 机器人 ──
  { key: 'bot_enabled', category: 'bot', type: 'boolean', label: '启用 Telegram Bot', description: '关闭后删除 webhook、停止处理消息与占用后台；需要时再开启即可。', default: 'true', env: 'BOT_ENABLED' },
  { key: 'bot_token', category: 'bot', type: 'secret', label: 'Bot Token', description: 'Telegram Bot token（BotFather 获取）。留空则机器人禁用。', default: '', env: 'BOT_TOKEN' },
  { key: 'bot_webhook_secret', category: 'bot', type: 'secret', label: 'Webhook Secret', description: 'webhook 校验密钥（x-telegram-bot-api-secret-token）。', default: '', env: 'BOT_WEBHOOK_SECRET' },
  { key: 'bot_admin_ids', category: 'bot', type: 'text', label: '管理员 ID（逗号分隔）', description: '允许使用机器人的 Telegram 用户 ID，多个用英文逗号分隔。', default: '', env: 'BOT_ADMIN_IDS', placeholder: '123456789,987654321' },
  { key: 'bot_proxy_type', category: 'bot', type: 'select', label: '中转类型', description: '境内访问 Telegram 的连接方式：HTTP(S) 代理 / SOCKS5 代理 / MTProto 中转。留空直连。', default: '', env: 'BOT_PROXY_TYPE', options: [
    { value: '', label: '无（直连 api.telegram.org）' },
    { value: 'http', label: 'HTTP(S) 代理' },
    { value: 'socks', label: 'SOCKS5 代理' },
    { value: 'mtproto', label: 'MTProto 中转 (apiRoot)' },
  ] },
  { key: 'bot_proxy_url', category: 'bot', type: 'text', label: '中转服务器地址', description: 'HTTP/SOCKS 代理填代理地址（如 http://127.0.0.1:19823）；MTProto 填 Bot API 反代根地址（如 https://tg-bot-api.example.com）。', default: '', env: 'BOT_PROXY_URL', placeholder: 'http://127.0.0.1:19823 或 https://tg-bot-api.example.com' },

  // ── 集成 ──
  { key: 'dl_proxy_type', category: 'integrations', type: 'select', label: '下载代理类型', description: 'gallery-dl 下载图片时使用的网络代理。可复用 Bot 代理地址（仅需 HTTP/SOCKS）。留空直连。', default: '', options: [
    { value: '', label: '无（直连）' },
    { value: 'http', label: 'HTTP(S) 代理' },
    { value: 'socks', label: 'SOCKS5 代理' },
  ] },
  { key: 'dl_proxy_url', category: 'integrations', type: 'text', label: '下载代理地址', description: '代理服务器地址（如 http://127.0.0.1:19823）。填入后 sidecar 下载图片走此代理，不配置 Telegram 机器人也可用。', default: '', placeholder: 'http://127.0.0.1:19823' },
  { key: 'pixiv_refresh_token', category: 'integrations', type: 'secret', label: 'Pixiv Refresh Token', description: 'gallery-dl Pixiv 登录刷新令牌（需同时配置 PHPSESSID）。', default: '', env: 'PIXIV_REFRESH_TOKEN' },
  { key: 'pixiv_phpsessid', category: 'integrations', type: 'secret', label: 'Pixiv PHPSESSID', description: 'Pixiv 会话 cookie。', default: '', env: 'PIXIV_PHPSESSID' },
  { key: 'backend_api_key', category: 'integrations', type: 'secret', label: 'Backend API Key', description: '平台合约 / API 客户端调用密钥（x-api-key）。', default: '', env: 'BACKEND_API_KEY' },

  // ── 基础设施（只读） ──
  { key: 'database_url', category: 'infra', type: 'readonly', label: 'Database URL', note: '由 DATABASE_URL 环境变量提供，仅展示与连通性测试。' },
  { key: 'redis_url', category: 'infra', type: 'readonly', label: 'Redis URL', note: '由 REDIS_URL 环境变量提供，仅展示与连通性测试。' },

  // ── 管理员（说明项） ──
  { key: 'admin_account', category: 'admin', type: 'readonly', label: '管理员账号', note: '账号密码请在「密码」面板中修改。' },
]

export const SETTING_DEF_MAP: Record<string, SettingDef> = Object.fromEntries(
  SETTING_DEFS.map(d => [d.key, d]),
)

export const SETTING_CATEGORIES: { key: SettingCategory; label: string; description: string }[] = [
  { key: 'site', label: '站点', description: '站点标题、URL、公告、维护模式等全局信息。' },
  { key: 'images', label: '图片', description: '缩略图与上传尺寸限制。' },
  { key: 'storage', label: '存储', description: 'S3 兼容对象存储配置。' },
  { key: 'bot', label: '机器人', description: 'Telegram 机器人令牌、权限与境内中转。' },
  { key: 'integrations', label: '集成', description: 'Pixiv 下载凭证与平台 API 密钥。' },
  { key: 'infra', label: '基础设施', description: '数据库与缓存连接（仅展示与测试，由环境变量提供）。' },
  { key: 'admin', label: '管理员', description: '管理员账号维护入口。' },
]

/** 敏感键清单（掩码显示 + 禁止公开） */
export const SECRET_KEYS = new Set(
  SETTING_DEFS.filter(d => d.secret).map(d => d.key),
)

/** 掩码规则：保留前 4 位，其余打码；短于 8 位全打码。 */
export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 4)}${'•'.repeat(Math.min(12, value.length - 4))}`
}
