import { Bot, type Context } from 'grammy'
import { sql } from 'drizzle-orm'
import type { PipelineResult } from '../../utils/queue'
import { db } from '../../utils/db'
import { redis } from '../../utils/redis'
import { searchPosts, getRandomPost, getPostBySource } from '../posts/repo'
import { isAiEnabled } from '../ai/config'
import { generatePostSummary } from '../ai/summary'
import { suggestRatingForPost } from '../ai/ratings'
import { reprocessTags } from '../ai/reprocess'
import { enqueueJob, pollJobResult } from '../../utils/queue'
import { identifySource, resolveSourceOrOther } from '../../utils/url-patterns'
import { isPrivateHost } from '../../utils/settings'
import { confirmRating, startCountdown, ratingCountdowns } from '../../utils/bot-rating'
import { posts, tags, postTags } from '../../schema'

// Custom context flavor: per-request bot config set by auth middleware.
// grammy standard pattern — one flavor declaration eliminates all ctx.config errors.
interface BotConfig {
  isAdmin: boolean
  lang: string
}
interface BotContext extends Context {
  config: BotConfig
}

// URL extraction pattern (from url-patterns.ts + generic)
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi

// ── Bot config: DB settings first, env as bootstrap fallback (v0.10.0) ──
// 热刷新：getBotConfig() 每次调用读取 settings（10s 缓存），token/adminIds/
// proxyUrl 变化后调用 rebuildBot() 重建实例。getBotConfig 内部已含 env 回退。
let _botInstance: Bot<BotContext> | null = null
let _buildPromise: Promise<Bot<BotContext>> | null = null
let _botReady: Promise<void> | null = null

// ── Per-chat concurrency semaphore (module-level: survives rebuildBot) ──
const chatSemaphores = new Map<string, { count: number; max: number; queue: (() => void)[] }>()
function getSemaphore(chatId: string, max = 3) {
  if (!chatSemaphores.has(chatId)) {
    chatSemaphores.set(chatId, { count: 0, max, queue: [] })
  }
  return chatSemaphores.get(chatId)!
}
async function acquireSemaphore(chatId: string): Promise<void> {
  const sem = getSemaphore(chatId)
  if (sem.count >= sem.max) {
    await new Promise<void>(resolve => sem.queue.push(resolve))
  }
  sem.count++
}
function releaseSemaphore(chatId: string) {
  const sem = chatSemaphores.get(chatId)
  if (!sem) return
  sem.count--
  const next = sem.queue.shift()
  if (next) next()
}

async function getBotConfigLazy() {
  const { getBotConfig } = await import('../../utils/settings')
  return getBotConfig()
}

/** 以当前配置构建 Bot 实例；代理/中转连接由 buildBotClient 统一处理。 */
async function buildBot(): Promise<Bot<BotContext>> {
  const cfg = await getBotConfigLazy()
  const { buildBotClient } = await import('../../utils/bot-proxy')
  type BotOpts = NonNullable<ConstructorParameters<typeof Bot<BotContext>>[1]>
  const opts: BotOpts = {}
  const client = buildBotClient(cfg.proxyType, cfg.proxyUrl)
  if (client) opts.client = client as BotOpts['client']
  return new Bot<BotContext>(cfg.token || 'unset', opts)
}

/**
 * 根据当前配置对齐 Telegram webhook（幂等，供启动与设置热刷新调用）：
 *   - enabled + token + siteUrl → setWebhook + setMyCommands
 *   - disabled 或 token 为空   → deleteWebhook（释放后台，停止 Telegram 推送）
 * 用一个独立于单例的 Bot 实例调用 API，避免与 disabled 状态/懒构建耦合。
 */
export async function syncBotWebhook(): Promise<void> {
  const cfg = await getBotConfigLazy()
  const token = cfg.token

  if (!cfg.enabled || !token) {
    // 尝试删除 webhook：让 Telegram 立即停止向本服务推送更新。
    if (token) {
      try {
        const temp = await buildBot()
        await temp.api.deleteWebhook()
        console.log('[bot-setup] webhook removed (bot disabled)')
      } catch (err) {
        console.warn('[bot-setup] deleteWebhook failed (non-fatal):', err)
      }
    } else {
      console.log('[bot-setup] bot_token not set, bot inactive')
    }
    return
  }

  if (!cfg.siteUrl) {
    console.warn('[bot-setup] site_url not set, skipping webhook registration')
    return
  }

  // ponytail: production webhook without webhook secret = unauthenticated
  // surface that anyone who can reach /bot/webhook can hit. Refuse to register
  // rather than warn-and-continue (matches the SESSION_SECRET guard in auth.ts).
  if (process.env.NODE_ENV === 'production' && !cfg.webhookSecret) {
    throw new Error('bot_webhook_secret must be set in production — refusing to register an unauthenticated Telegram webhook')
  }

  const b = await buildBot()
  const webhookUrl = `${cfg.siteUrl.replace(/\/+$/, '')}/bot/webhook`
  await b.api.setWebhook(webhookUrl, {
    secret_token: cfg.webhookSecret || undefined,
    drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query'],
  })
  await b.api.setMyCommands([
    { command: 'save', description: '保存图片 / Save image' },
    { command: 'info', description: '查询作品信息 / Post info' },
    { command: 'search', description: '搜索作品 / Search' },
    { command: 'random', description: '随机作品 / Random' },
    { command: 'stats', description: '站点统计 / Stats' },
    { command: 'autopass', description: '自动评级开关 / Toggle autopass' },
    { command: 'aitags', description: 'AI 标签处理 / AI tag processing' },
    { command: 'lang', description: '切换语言 / Switch language' },
    { command: 'start', description: '开始使用 / Start' },
  ], { scope: { type: 'all_private_chats' } })
  console.log('[bot-setup] webhook registered:', webhookUrl, cfg.proxyUrl ? `(via ${cfg.proxyUrl})` : '')
}

/** 获取（惰性构建）Bot 实例；首次构建时注册全部 handler。
 *  in-flight promise guard: 并发调用共享同一个 build，避免 orphan Bot 泄漏。
 *  bot_enabled=false 时抛出——由 webhook auth 层先转为 404。 */
export async function getBot(): Promise<Bot<BotContext>> {
  const cfg = await getBotConfigLazy()
  if (!cfg.enabled) throw new Error('Telegram bot is disabled (bot_enabled=false)')
  if (_botInstance) return _botInstance
  if (_buildPromise) return _buildPromise
  _buildPromise = (async () => {
    const b = await buildBot()
    await syncSiteUrl()
    registerHandlers(b)
    _botInstance = b  // atomic swap — old instance stays live until new one is ready
    _botReady = null
    return b
  })()
  try {
    return await _buildPromise
  } finally {
    _buildPromise = null
  }
}

/** settings 热刷新：构建新实例后原子替换（不先 null）。bot 禁用时不构建。 */
export async function rebuildBot() {
  _botInstance = null  // ponytail: null so getBot builds fresh; old instance GC'd
  _buildPromise = null
  _botReady = null
  const cfg = await getBotConfigLazy()
  if (!cfg.enabled) return  // 禁用态：webhook 对齐由 syncBotWebhook 处理
  await getBot()
}

async function getS3ExternalUrlLazy(): Promise<string> {
  const { getS3ExternalUrl } = await import('../../utils/s3')
  return getS3ExternalUrl()
}

// ── Admin IDs / Site URL（运行时读取，支持热刷新） ──
async function getAdminIds(): Promise<number[]> {
  const cfg = await getBotConfigLazy()
  return cfg.adminIds
}

async function getSiteUrlLazy(): Promise<string> {
  const { getSiteUrl } = await import('../../utils/settings')
  return getSiteUrl()
}

// ── Bot 实例：Proxy 转发到当前实例，热刷新重建后 handler 由
// registerHandlers 重新注册到新实例。外部（webhook/auth）仍按原 API 用 bot。

export async function ensureBotReady(): Promise<void> {
  const cfg = await getBotConfigLazy()
  if (!cfg.token || !cfg.enabled) return
  const b = await getBot()
  if (!_botReady) _botReady = b.init()
  await _botReady
}

// SITE_URL / admin ids 运行时值（热刷新支持）——handler 闭包读取的是 let 变量。
let SITE_URL = ''

/** 更新运行时站点 URL（getBot/rebuildBot 时同步）。 */
async function syncSiteUrl() {
  SITE_URL = await getSiteUrlLazy()
}

const botHandlerProxy: ProxyHandler<Bot<BotContext>> = {
  get(_t: Bot<BotContext>, prop: string | symbol) {
    const real = _botInstance ?? new Bot<BotContext>('unset')
    const val = Reflect.get(real, prop)
    // 方法转发时绑定真实实例，避免 this 指向 proxy。
    return typeof val === 'function' ? val.bind(real) : val
  },
  set(_t: Bot<BotContext>, prop: string | symbol, value: unknown) {
    const real = _botInstance ?? new Bot<BotContext>('unset')
    return Reflect.set(real, prop, value)
  },
}

export const bot: Bot<BotContext> = new Proxy<Bot<BotContext>>(
  {} as Bot<BotContext>,
  botHandlerProxy,
)

// ── i18n helpers (T-P3-4: centralized) — module-level: handlers inside
// registerHandlers and pollAndNotify/showRatingMenu (module-level) both use t().
const T = {
  zh: {
    welcome: '👋 你好！发送图片链接来保存到图库。\n\n命令：\n/search 标签名 — 搜索\n/random — 随机图片\n/stats — 统计\n/autopass — 自动标记为公开\n/lang — 切换语言',
    noResults: '未找到结果',
    noPosts: '暂无图片',
    queued: (jobId: string) => `📥 已加入下载队列\n任务ID：${jobId.slice(0, 8)}…`,
    downloading: '⏳ 下载中...',
    timeout: '⏰ 下载超时',
    duplicate: (postId: string) => `⚠️ 重复图片，已有作品: ${SITE_URL}/posts/${postId}`,
    tooLarge: '⚠️ 图片过大，已跳过',
    failed: '❌ 下载失败',
    success: (postId: string, autoRating?: string) => `✅ 处理完成\n${autoRating ? `自动评级建议: ${autoRating}\n` : ''}⏳ 等待评级 (10s)`,
    ratingConfirmed: (rating: string, label: string) => {
      const emoji: Record<string, string> = { safe: '🟢', questionable: '🟡', explicit: '🔴' }
      const name: Record<string, string> = { safe: '公开', questionable: '敏感', explicit: '限制' }
      return `✅ 处理完成\n评级: ${emoji[rating] || ''} ${name[rating] || rating} ${label}`
    },
    stats: (posts: number, tags: number, postTags: number, storage: string) => `📊 统计\n图片：${posts}\n标签：${tags}\n关联：${postTags}\n存储：${storage}`,
    autopassOn: '✅ 自动通过已开启',
    autopassOff: '❌ 自动通过已关闭',
    langSwitched: '🌐 语言已切换为中文',
    langUsage: () => `用法: /lang en 或 /lang zh\n当前: 中文`,
    langCurrent: '中文',
    usageSearch: '用法: /search <标签>',
    usageInfo: '用法: /info <url>',
    noSource: '未识别来源',
    notFound: '未找到作品',
    adminOnly: '仅管理员可用',
    unauthorized: '⛔ 未授权',
    searchResults: (query: string, count: number) => `🔍 "${query}" — ${count} 个结果`,
    randomCaption: (title: string) => `🎲 ${title || '(无标题)'}`,
    untitled: '(无标题)',
    multiQueued: (count: number) => `📥 已入队 ${count} 个任务`,
    blockedPrivate: (count: number) => `⛔ 已拒绝 ${count} 个内网/私网地址`,
  },
  en: {
    welcome: '👋 Hello! Send an image URL to save to the gallery.\n\nCommands:\n/search tag — Search\n/random — Random image\n/stats — Statistics\n/autopass — Auto-mark as safe\n/lang — Switch language',
    noResults: 'No results',
    noPosts: 'No posts',
    queued: (jobId: string) => `📥 Queued for download\nTask: ${jobId.slice(0, 8)}…`,
    downloading: '⏳ Downloading...',
    timeout: '⏰ Download timed out',
    duplicate: (postId: string) => `⚠️ Duplicate, existing post: ${SITE_URL}/posts/${postId}`,
    tooLarge: '⚠️ Image too large, skipped',
    failed: '❌ Download failed',
    success: (postId: string, autoRating?: string) => `✅ Processing complete\n${autoRating ? `Auto-rating: ${autoRating}\n` : ''}⏳ Waiting for rating (10s)`,
    ratingConfirmed: (rating: string, label: string) => {
      const emoji: Record<string, string> = { safe: '🟢', questionable: '🟡', explicit: '🔴' }
      return `✅ Processing complete\nRating: ${emoji[rating] || ''} ${rating} ${label}`
    },
    stats: (posts: number, tags: number, postTags: number, storage: string) => `📊 Stats\nPosts: ${posts}\nTags: ${tags}\nTag links: ${postTags}\nStorage: ${storage}`,
    autopassOn: '✅ Autopass enabled',
    autopassOff: '❌ Autopass disabled',
    langSwitched: '🌐 Language switched to English',
    langUsage: () => `Usage: /lang en or /lang zh\nCurrent: English`,
    langCurrent: 'English',
    usageSearch: 'Usage: /search <tag>',
    usageInfo: 'Usage: /info <url>',
    noSource: 'Unrecognized source',
    notFound: 'Post not found',
    adminOnly: 'Admin only',
    unauthorized: '⛔ Unauthorized',
    searchResults: (query: string, count: number) => `🔍 "${query}" — ${count} results`,
    randomCaption: (title: string) => `🎲 ${title || 'Untitled'}`,
    untitled: 'Untitled',
    multiQueued: (count: number) => `📥 ${count} tasks queued`,
    blockedPrivate: (count: number) => `⛔ Blocked ${count} private/internal address${count === 1 ? '' : 'es'}`,
  },
}

function t(key: string, lang: string, ...args: any[]): string {
  const strings: Record<string, any> = lang === 'zh' ? T.zh : T.en
  const val = strings[key]
  return typeof val === 'function' ? val(...args) : (val || key)
}

function registerHandlers(b: Bot<BotContext>) {

// ── Auth middleware (T-P0-4: reject non-admins) ──
b.use(async (ctx, next) => {
  const userId = ctx.from?.id

  // Handle forwarded channel messages (negative ID)
  const effectiveUserId = (ctx.chat?.type === 'private' && userId && userId < 0)
    ? ctx.chat?.id : userId

  const adminIds = await getAdminIds()
  const isAdmin = effectiveUserId ? adminIds.includes(effectiveUserId) : false
  ctx.config = { isAdmin, lang: 'zh' }

  if (!isAdmin) {
    try { await ctx.reply(t('unauthorized', ctx.config.lang)) } catch { /* ignore */ }
    return // don't propagate to handlers
  }
  await next()
})

// ── Per-chat language from Redis ──
b.use(async (ctx, next) => {
  if (!ctx.config.isAdmin) return // already rejected above, but guard
  const chatId = ctx.chat?.id?.toString()
  if (chatId) {
    // Try new key, fall back to old key (T-P2-1 migration)
    let lang = await redis.get(`kura:bot:lang:${chatId}`)
    if (!lang) {
      lang = await redis.get(`kura:bot_lang:${chatId}`)
      if (lang) await redis.set(`kura:bot:lang:${chatId}`, lang)
      else lang = 'en' // default to en (old default)
    }
    ctx.config.lang = lang
  }
  await next()
})

// ── i18n helpers: T/t 定义已移至模块级（registerHandlers 上方），
// handler 与 pollAndNotify 共享同一份。

// ── Commands ──

b.command('start', async (ctx) => {
  try {
    const keyboard = {
      inline_keyboard: [[
        { text: '🌐 Open Gallery', web_app: { url: SITE_URL } },
      ]],
    }
    await ctx.reply(t('welcome', ctx.config.lang), { reply_markup: keyboard }).catch(() => {})
  } catch (err) { console.error('[bot] start error:', err) }
})

b.command('search', async (ctx) => {
  try {
    const query = ctx.message?.text?.split(' ').slice(1).join(' ')
    if (!query) { await ctx.reply(t('usageSearch', ctx.config.lang)).catch(() => {}); return }

    const results = await searchPosts(query, { perPage: 5, isAdmin: true })
    if (!results.items.length) { await ctx.reply(t('noResults', ctx.config.lang)).catch(() => {}); return }

    const keyboard = {
      inline_keyboard: [
        ...results.items.map((p: any) => [{
          text: p.title || `#${p.id.slice(0, 8)}`,
          callback_data: `post:${p.id}`,
        }]),
      ],
    }
    await ctx.reply(
      t('searchResults', ctx.config.lang, query, results.total),
      { reply_markup: keyboard },
    ).catch(() => {})
  } catch (err) { console.error('[bot] search error:', err) }
})

b.command('random', async (ctx) => {
  try {
    const post = await getRandomPost(true)
    if (!post) { await ctx.reply(t('noPosts', ctx.config.lang)).catch(() => {}); return }

    const previewUrl = post.preview_key
      ? `${await getS3ExternalUrlLazy()}/${post.preview_key}`
      : null

    const caption = `${t('randomCaption', ctx.config.lang, post.title || '')}\n${SITE_URL}/posts/${post.id}`
    const keyboard = {
      inline_keyboard: [[
        { text: '🔗 View', url: `${SITE_URL}/posts/${post.id}` },
        { text: '🎲 Another', callback_data: 'random:another' },
      ]],
    }

    if (previewUrl) {
      try {
        await ctx.replyWithPhoto(previewUrl, { caption, reply_markup: keyboard })
        return
      } catch { /* fallback to text */ }
    }
    await ctx.reply(caption, { reply_markup: keyboard }).catch(() => {})
  } catch (err) { console.error('[bot] random error:', err) }
})

b.command('stats', async (ctx) => {
  try {
    const [pc, tc, ptc, sc] = await Promise.all([
      db.select({ count: sql`count(*)` }).from(posts),
      db.select({ count: sql`count(*)` }).from(tags),
      db.select({ count: sql`count(*)` }).from(postTags),
      db.select({ total: sql`COALESCE(SUM(file_size), 0)` }).from(posts),
    ])
    const totalSize = Number(sc[0]?.total ?? 0)
    const sizeStr = totalSize >= 1073741824
      ? (totalSize / 1073741824).toFixed(1) + ' GB'
      : totalSize >= 1048576
        ? (totalSize / 1048576).toFixed(1) + ' MB'
        : (totalSize / 1024).toFixed(1) + ' KB'
    await ctx.reply(t('stats', ctx.config.lang, Number(pc[0]?.count ?? 0), Number(tc[0]?.count ?? 0), Number(ptc[0]?.count ?? 0), sizeStr)).catch(() => {})
  } catch (err) { console.error('[bot] stats error:', err) }
})

b.command('autopass', async (ctx) => {
  try {
    const chatId = ctx.chat?.id?.toString()
    if (!chatId) return

    const current = await redis.get(`kura:bot:autopass:${chatId}`)
    const newVal = current === '1' ? '0' : '1'
    await redis.set(`kura:bot:autopass:${chatId}`, newVal)

    await ctx.reply(newVal === '1' ? t('autopassOn', ctx.config.lang) : t('autopassOff', ctx.config.lang)).catch(() => {})
  } catch (err) { console.error('[bot] autopass error:', err) }
})

b.command('lang', async (ctx) => {
  try {
    const chatId = ctx.chat?.id?.toString()
    if (!chatId) return

    const arg = ctx.message?.text?.split(' ')[1]
    if (arg === 'en' || arg === 'zh') {
      await redis.set(`kura:bot:lang:${chatId}`, arg, { expiration: { type: 'EX', value: 30 * 86400 } }) // 30d TTL
      ctx.config.lang = arg
      await ctx.reply(t('langSwitched', arg)).catch(() => {})
    } else {
      const current = ctx.config.lang
      await ctx.reply(t('langUsage', ctx.config.lang)).catch(() => {})
    }
  } catch (err) { console.error('[bot] lang error:', err) }
})

b.command('info', async (ctx) => {
  try {
    const url = ctx.message?.text?.split(' ').slice(1).join(' ')
    if (!url) { await ctx.reply(t('usageInfo', ctx.config.lang)).catch(() => {}); return }

    const source = identifySource(url)
    if (!source) { await ctx.reply(t('noSource', ctx.config.lang)).catch(() => {}); return }

    const post = await getPostBySource(source.site, source.id, true)
    if (!post) { await ctx.reply(t('notFound', ctx.config.lang)).catch(() => {}); return }

    const ratingEmoji: Record<string, string> = { safe: '🟢', questionable: '🟡', explicit: '🔴' }
    let baseInfo = `📌 ${post.title || t('untitled', ctx.config.lang)}\n` +
      `🔗 ${SITE_URL}/posts/${post.id}\n` +
      `📐 ${post.width}x${post.height}\n` +
      `🏷 ${ratingEmoji[post.rating] || ''} ${post.rating}\n` +
      `📅 ${post.created_at}\n` +
      `🏷 Tags: ${(post.tags || []).map((t: any) => t.name).join(', ')}`

    // AI summary (non-blocking)
    if (isAiEnabled()) {
      try {
        const summary = await generatePostSummary(post)
        if (summary) baseInfo += `\n\n✨ AI: ${summary}`
      } catch { /* non-blocking */ }
    }

    await ctx.reply(baseInfo.slice(0, 4096)).catch(() => {})
  } catch (err) { console.error('[bot] info error:', err) }
})

b.command('save', async (ctx) => {
  try {
    const url = ctx.message?.text?.split(' ').slice(1).join(' ')
    if (!url) { await ctx.reply(t('usageInfo', ctx.config.lang)).catch(() => {}); return }
    // Process same as URL handler — extract and enqueue
    const source = identifySource(url) || resolveSourceOrOther(url)
    const chatId = ctx.chat?.id?.toString() || 'unknown'
    const jobId = await enqueueJob({ url, source_site: source.site, source_id: source.id })
    const msg = await ctx.reply(t('downloading', ctx.config.lang))
    pollAndNotify(ctx.api, chatId, msg.message_id, jobId, ctx.config.lang).catch(
      err => console.error('[bot] poll error:', err),
    )
  } catch (err) { console.error('[bot] save error:', err) }
})

// ! aliases (T-P1-2)
b.hears(/^!save\b/, async (ctx) => {
  try {
    const url = ctx.message?.text?.replace(/^!save\s*/, '').trim()
    if (!url) return
    const source = identifySource(url) || resolveSourceOrOther(url)
    const chatId = ctx.chat?.id?.toString() || 'unknown'
    const jobId = await enqueueJob({ url, source_site: source.site, source_id: source.id })
    const msg = await ctx.reply(t('downloading', ctx.config.lang))
    pollAndNotify(ctx.api, chatId, msg.message_id, jobId, ctx.config.lang).catch(
      err => console.error('[bot] poll error:', err),
    )
  } catch (err) { console.error('[bot] !save error:', err) }
})

b.hears(/^!search\b/, async (ctx) => {
  try {
    const query = ctx.message?.text?.replace(/^!search\s*/, '').trim()
    if (!query) return
    const results = await searchPosts(query, { perPage: 5, isAdmin: true })
    if (!results.items.length) { await ctx.reply(t('noResults', ctx.config.lang)).catch(() => {}); return }
    for (const post of results.items.slice(0, 5)) {
      await ctx.reply(`${post.title || t('untitled', ctx.config.lang)}\n${SITE_URL}/posts/${post.id}`).catch(() => {})
    }
  } catch (err) { console.error('[bot] !search error:', err) }
})

b.hears(/^!random$/, async (ctx) => {
  try {
    const post = await getRandomPost(true)
    if (!post) { await ctx.reply(t('noPosts', ctx.config.lang)).catch(() => {}); return }
    await ctx.reply(`${t('randomCaption', ctx.config.lang, post.title || '')}\n${SITE_URL}/posts/${post.id}`).catch(() => {})
  } catch (err) { console.error('[bot] !random error:', err) }
})

b.hears(/^!info\b/, async (ctx) => {
  try {
    const url = ctx.message?.text?.replace(/^!info\s*/, '').trim()
    if (!url) return
    const source = identifySource(url)
    if (!source) { await ctx.reply(t('noSource', ctx.config.lang)).catch(() => {}); return }
    const post = await getPostBySource(source.site, source.id, true)
    if (!post) { await ctx.reply(t('notFound', ctx.config.lang)).catch(() => {}); return }
    const ratingEmoji: Record<string, string> = { safe: '🟢', questionable: '🟡', explicit: '🔴' }
    let reply = `${post.title || t('untitled', ctx.config.lang)}\n${SITE_URL}/posts/${post.id}\n${ratingEmoji[post.rating] || ''} ${post.rating}`
    if (isAiEnabled()) {
      try { const summary = await generatePostSummary(post); if (summary) reply += `\n✨ ${summary}` } catch { /* non-blocking */ }
    }
    await ctx.reply(reply.slice(0, 4096)).catch(() => {})
  } catch (err) { console.error('[bot] !info error:', err) }
})

// ── /aitags command (AI capability ⑦) ──
b.command('aitags', async (ctx) => {
  try {
    const modeArg = ctx.message?.text?.split(' ')[1]
    const mode = (modeArg === 'all' ? 'all' : 'unprocessed') as 'unprocessed' | 'all'
    const lang = ctx.config.lang
    if (!isAiEnabled()) {
      await ctx.reply(lang === 'zh' ? 'AI 处理未启用' : 'AI processing not enabled').catch(() => {})
      return
    }
    const processingMsg = await ctx.reply('⏳ AI 标签处理中…').catch(() => {})
    const result = await reprocessTags(mode)
    const text = lang === 'zh'
      ? `✅ 处理完成: ${result.processed} 成功, ${result.failed} 失败`
      : `✅ Done: ${result.processed} processed, ${result.failed} failed`
    if (processingMsg) {
      await ctx.api.editMessageText(ctx.chat!.id, processingMsg.message_id, text).catch(() => {})
    } else {
      await ctx.reply(text).catch(() => {})
    }
  } catch (err) { console.error('[bot] /aitags error:', err) }
})

// ── URL detection handler (T-P0-1: extract URLs from text) ──
b.on('message:text', async (ctx) => {
  try {
    const text = ctx.message.text

    // Extract URLs from message text (not whole text as URL)
    const urls = [...new Set(text.match(URL_PATTERN) || [])]
    if (urls.length === 0) return

    const chatId = ctx.chat?.id?.toString() || 'unknown'

    // Process each URL (cap at 10). Enqueue jobs in parallel (Redis LPUSH is
    // atomic; semaphore still serializes per chatId), then send reply + start
    // poll in sequence — Telegram's Bot API rate-limits bursts of ctx.reply.
    // ponytail: ctx.reply kept serial — switching to Promise.all risks 429.
    const toProcess = urls.slice(0, 10)
    const queued: { url: string; jobId: string; source: ReturnType<typeof identifySource> | ReturnType<typeof resolveSourceOrOther> }[] = []
    const rejected: string[] = []

    await Promise.all(toProcess.map(async (url) => {
      const source = identifySource(url) || resolveSourceOrOther(url)
      // SSRF pre-check: refuse private/loopback addresses before they reach the
      // job queue. Sidecar re-validates inside the worker, but this stops
      // queue spam from probing the internal network.
      if (await isPrivateHost(new URL(url).hostname)) {
        rejected.push(url)
        return
      }
      await acquireSemaphore(chatId)
      try {
        const jobId = await enqueueJob({ url, source_site: source.site, source_id: source.id })
        queued.push({ url, jobId, source })
      } finally {
        releaseSemaphore(chatId)
      }
    }))

    if (rejected.length) {
      await ctx.reply(t('blockedPrivate', ctx.config.lang, rejected.length)).catch(() => {})
    }

    for (const { jobId } of queued) {
      const msg = await ctx.reply(t('downloading', ctx.config.lang))
      // Fire-and-forget polling (T-P0-2)
      pollAndNotify(ctx.api, chatId, msg.message_id, jobId, ctx.config.lang).catch(
        err => console.error('[bot] poll error:', err),
      )
    }

    if (toProcess.length > 1) {
      await ctx.reply(t('multiQueued', ctx.config.lang, toProcess.length)).catch(() => {})
    }
  } catch (err) { console.error('[bot] URL handler error:', err) }
})

// ── Photo caption handler (T-P1-6) ──
b.on('message:photo', async (ctx) => {
  try {
    const caption = ctx.message.caption || ''
    const urls = [...new Set(caption.match(URL_PATTERN) || [])]
    if (urls.length === 0) return

    const chatId = ctx.chat?.id?.toString() || 'unknown'
    const queued: { jobId: string }[] = []
    const rejected: string[] = []

    await Promise.all(urls.slice(0, 10).map(async (url) => {
      const source = identifySource(url) || resolveSourceOrOther(url)
      // SSRF pre-check (see message:text handler)
      if (await isPrivateHost(new URL(url).hostname)) {
        rejected.push(url)
        return
      }
      await acquireSemaphore(chatId)
      try {
        const jobId = await enqueueJob({ url, source_site: source.site, source_id: source.id })
        queued.push({ jobId })
      } finally {
        releaseSemaphore(chatId)
      }
    }))

    if (rejected.length) {
      await ctx.reply(t('blockedPrivate', ctx.config.lang, rejected.length)).catch(() => {})
    }

    for (const { jobId } of queued) {
      const msg = await ctx.reply(t('downloading', ctx.config.lang))
      pollAndNotify(ctx.api, chatId, msg.message_id, jobId, ctx.config.lang).catch(
        err => console.error('[bot] poll error:', err),
      )
    }
  } catch (err) { console.error('[bot] photo handler error:', err) }
})

// ── Callback query handler (T-P0-3: rating buttons + search pagination + random) ──
b.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data ?? ''
  const chatId = ctx.chat?.id?.toString()
  if (!chatId) return

  try {
    if (data.startsWith('rate:')) {
      const [, postId, rating] = data.split(':')
      if (!postId || !rating) return
      // Cancel countdown if user manually selected
      const timer = ratingCountdowns.get(postId)
      if (timer) { clearInterval(timer); ratingCountdowns.delete(postId) }
      await confirmRating(ctx.api, chatId, ctx.callbackQuery.message?.message_id!, postId, rating, ctx.config.lang, ctx.config.lang === 'zh' ? '（手动）' : '(manual)')
    } else if (data.startsWith('random:another')) {
      const post = await getRandomPost(true)
      if (!post) return ctx.answerCallbackQuery({ text: t('noPosts', ctx.config.lang) })
      const previewUrl = post.preview_key ? `${await getS3ExternalUrlLazy()}/${post.preview_key}` : null
      const caption = `${t('randomCaption', ctx.config.lang, post.title || '')}\n${SITE_URL}/posts/${post.id}`
      const keyboard = {
        inline_keyboard: [[
          { text: '🔗 View', url: `${SITE_URL}/posts/${post.id}` },
          { text: '🎲 Another', callback_data: 'random:another' },
        ]],
      }
      if (previewUrl) {
        try {
          await ctx.editMessageMedia(
            { type: 'photo', media: previewUrl, caption },
            { reply_markup: keyboard },
          )
        } catch { /* ignore */ }
      }
    } else if (data.startsWith('post:')) {
      const postId = data.slice(5)
      await ctx.answerCallbackQuery({ url: `${SITE_URL}/posts/${postId}` })
    }
  } catch (err: any) {
    if (!err.message?.includes('message is not modified')) {
      console.error('[bot] callback error:', err)
    }
  }

  await ctx.answerCallbackQuery().catch(() => {})
})

}

// ── Poll and notify (T-P0-2) ──
async function pollAndNotify(
  api: any,
  chatId: string,
  messageId: number,
  jobId: string,
  lang: string,
) {
  const result = await pollJobResult(jobId, 300_000) // 5 min timeout
  if (!result) {
    await api.editMessageText(chatId, messageId, t('timeout', lang)).catch(() => {})
    return
  }

  switch (result.status) {
    case 'success': {
      const postId = result.post_id!
      const autopass = await redis.get(`kura:bot:autopass:${chatId}`)
      // AI rating suggestion (non-blocking)
      let aiSuggestion: { rating: string; confidence: number } | null = null
      if (isAiEnabled()) {
        try { const s = await suggestRatingForPost(postId); if (s) aiSuggestion = { rating: s.rating, confidence: s.confidence } }
        catch { /* non-blocking */ }
      }
      if (autopass === '1') {
        const rating = result.auto_rating || aiSuggestion?.rating || 'safe'
        await confirmRating(api, chatId, messageId, postId, rating, lang, lang === 'zh' ? '（自动）' : '(auto)')
      } else {
        await showRatingMenu(api, chatId, messageId, postId, result.auto_rating, aiSuggestion, lang)
      }
      break
    }
    case 'duplicate':
      await api.editMessageText(chatId, messageId, t('duplicate', lang, result.existing_post_id || '?')).catch(() => {})
      break
    case 'too_large':
      await api.editMessageText(chatId, messageId, t('tooLarge', lang)).catch(() => {})
      break
    case 'failed':
      await api.editMessageText(chatId, messageId, t('failed', lang)).catch(() => {})
      break
  }
}

// ── Rating menu (T-P0-3) ──
async function showRatingMenu(
  api: any,
  chatId: string,
  messageId: number,
  postId: string,
  autoRating: string | undefined,
  aiSuggestion: { rating: string; confidence: number } | null | undefined,
  lang: string,
) {
  const keyboard = {
    inline_keyboard: [[
      { text: '🟢 Safe', callback_data: `rate:${postId}:safe` },
      { text: '🟡 Questionable', callback_data: `rate:${postId}:questionable` },
      { text: '🔴 Explicit', callback_data: `rate:${postId}:explicit` },
    ]],
  }

  const autoNote = autoRating ? `\n${lang === 'zh' ? '自动规则建议' : 'Auto-rating'}: ${autoRating}` : ''
  const aiNote = aiSuggestion ? `\n✨ AI ${lang === 'zh' ? '建议' : 'suggest'}: ${aiSuggestion.rating} (${Math.round(aiSuggestion.confidence * 100)}%)` : ''

  await api.editMessageText(
    chatId, messageId,
    t('success', lang, postId, autoRating) + aiNote,
    { reply_markup: keyboard },
  ).catch(() => {})

  // Start 10s countdown
  startCountdown(api, chatId, messageId, postId, autoRating, lang, ratingCountdowns)
}
