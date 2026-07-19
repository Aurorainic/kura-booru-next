import { Bot, type Context } from 'grammy'
import { sql } from 'drizzle-orm'
import type { PipelineResult } from '../../utils/queue'

// Custom context flavor: per-request bot config set by auth middleware.
// grammy standard pattern — one flavor declaration eliminates all ctx.config errors.
interface BotConfig {
  isAdmin: boolean
  lang: string
}
interface BotContext extends Context {
  config: BotConfig
}

const BOT_TOKEN = process.env.BOT_TOKEN || ''
const BOT_ADMIN_IDS = (process.env.BOT_ADMIN_IDS || '').split(',').map(Number).filter(Boolean)
const SITE_URL = process.env.SITE_URL || ''

// URL extraction pattern (from url-patterns.ts + generic)
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi

if (!BOT_TOKEN) {
  console.warn('[bot] BOT_TOKEN not set, bot disabled')
}

export const bot = new Bot<BotContext>(BOT_TOKEN)

// Lazy-init
let _botReady: Promise<void> | null = null
export function ensureBotReady() {
  if (!_botReady) _botReady = bot.init()
  return _botReady
}

// ── Auth middleware (T-P0-4: reject non-admins) ──
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id

  // Handle forwarded channel messages (negative ID)
  const effectiveUserId = (ctx.chat?.type === 'private' && userId && userId < 0)
    ? ctx.chat?.id : userId

  const isAdmin = effectiveUserId ? BOT_ADMIN_IDS.includes(effectiveUserId) : false
  ctx.config = { isAdmin, lang: 'zh' }

  if (!isAdmin) {
    try { await ctx.reply(t('unauthorized', ctx.config.lang)) } catch { /* ignore */ }
    return // don't propagate to handlers
  }
  await next()
})

// ── Per-chat language from Redis ──
bot.use(async (ctx, next) => {
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

// ── Per-chat concurrency semaphore (T-P3-3: only wrap enqueueJob, not entire handler) ──
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

// ── i18n helpers (T-P3-4: centralized) ──
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

export function t(key: string, lang: string, ...args: any[]): string {
  const strings: Record<string, any> = lang === 'zh' ? T.zh : T.en
  const val = strings[key]
  return typeof val === 'function' ? val(...args) : (val || key)
}

export const i18nLabels = {
  zh: {
    processingComplete: '处理完成',
    waitingRating: '等待评级',
    rating: '评级',
    autoRule: '自动规则',
    default: '默认',
    manual: '手动',
    auto: '自动',
  },
  en: {
    processingComplete: 'Processing complete',
    waitingRating: 'Waiting for rating',
    rating: 'Rating',
    autoRule: 'Auto-rating',
    default: 'default',
    manual: 'manual',
    auto: 'auto',
  },
}

// ── Commands ──

bot.command('start', async (ctx) => {
  try {
    const keyboard = {
      inline_keyboard: [[
        { text: '🌐 Open Gallery', web_app: { url: SITE_URL } },
      ]],
    }
    await ctx.reply(t('welcome', ctx.config.lang), { reply_markup: keyboard }).catch(() => {})
  } catch (err) { console.error('[bot] start error:', err) }
})

bot.command('search', async (ctx) => {
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

bot.command('random', async (ctx) => {
  try {
    const post = await getRandomPost(true)
    if (!post) { await ctx.reply(t('noPosts', ctx.config.lang)).catch(() => {}); return }

    const previewUrl = post.preview_key
      ? `${process.env.S3_EXTERNAL_URL || ''}/${post.preview_key}`
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

bot.command('stats', async (ctx) => {
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

bot.command('autopass', async (ctx) => {
  try {
    const chatId = ctx.chat?.id?.toString()
    if (!chatId) return

    const current = await redis.get(`kura:bot:autopass:${chatId}`)
    const newVal = current === '1' ? '0' : '1'
    await redis.set(`kura:bot:autopass:${chatId}`, newVal)

    await ctx.reply(newVal === '1' ? t('autopassOn', ctx.config.lang) : t('autopassOff', ctx.config.lang)).catch(() => {})
  } catch (err) { console.error('[bot] autopass error:', err) }
})

bot.command('lang', async (ctx) => {
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

bot.command('info', async (ctx) => {
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
    if (process.env.ENABLE_AI_TAG_PROCESSING === 'true') {
      try {
        const summary = await generatePostSummary(post)
        if (summary) baseInfo += `\n\n✨ AI: ${summary}`
      } catch { /* non-blocking */ }
    }

    await ctx.reply(baseInfo.slice(0, 4096)).catch(() => {})
  } catch (err) { console.error('[bot] info error:', err) }
})

bot.command('save', async (ctx) => {
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
bot.hears(/^!save\b/, async (ctx) => {
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

bot.hears(/^!search\b/, async (ctx) => {
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

bot.hears(/^!random$/, async (ctx) => {
  try {
    const post = await getRandomPost(true)
    if (!post) { await ctx.reply(t('noPosts', ctx.config.lang)).catch(() => {}); return }
    await ctx.reply(`${t('randomCaption', ctx.config.lang, post.title || '')}\n${SITE_URL}/posts/${post.id}`).catch(() => {})
  } catch (err) { console.error('[bot] !random error:', err) }
})

bot.hears(/^!info\b/, async (ctx) => {
  try {
    const url = ctx.message?.text?.replace(/^!info\s*/, '').trim()
    if (!url) return
    const source = identifySource(url)
    if (!source) { await ctx.reply(t('noSource', ctx.config.lang)).catch(() => {}); return }
    const post = await getPostBySource(source.site, source.id, true)
    if (!post) { await ctx.reply(t('notFound', ctx.config.lang)).catch(() => {}); return }
    const ratingEmoji: Record<string, string> = { safe: '🟢', questionable: '🟡', explicit: '🔴' }
    let reply = `${post.title || t('untitled', ctx.config.lang)}\n${SITE_URL}/posts/${post.id}\n${ratingEmoji[post.rating] || ''} ${post.rating}`
    if (process.env.ENABLE_AI_TAG_PROCESSING === 'true') {
      try { const summary = await generatePostSummary(post); if (summary) reply += `\n✨ ${summary}` } catch { /* non-blocking */ }
    }
    await ctx.reply(reply.slice(0, 4096)).catch(() => {})
  } catch (err) { console.error('[bot] !info error:', err) }
})

// ── /aitags command (AI capability ⑦) ──
bot.command('aitags', async (ctx) => {
  try {
    const modeArg = ctx.message?.text?.split(' ')[1]
    const mode = (modeArg === 'all' ? 'all' : 'unprocessed') as 'unprocessed' | 'all'
    const lang = ctx.config.lang
    if (process.env.ENABLE_AI_TAG_PROCESSING !== 'true') {
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

// ── /ai command (AI capability ⑧) ──
bot.command('ai', async (ctx) => {
  try {
    const query = ctx.message?.text?.split(' ').slice(1).join(' ')
    if (!query) {
      await ctx.reply(ctx.config.lang === 'zh' ? '用法: /ai <问题>' : 'Usage: /ai <question>').catch(() => {})
      return
    }
    if (process.env.ENABLE_AI_TAG_PROCESSING !== 'true') {
      await ctx.reply(ctx.config.lang === 'zh' ? 'AI 未启用' : 'AI not enabled').catch(() => {})
      return
    }
    const thinkingMsg = await ctx.reply('🤔 思考中…').catch(() => {})
    const reply = await adminAssistantChat(query, { source: 'bot', lang: ctx.config.lang })
    const keyboard = reply.suggestions?.length
      ? { inline_keyboard: reply.suggestions.slice(0, 8).map(s => [{ text: s.label.slice(0, 64), callback_data: s.callback_data.slice(0, 64) }]) }
      : undefined
    if (thinkingMsg) {
      await ctx.api.editMessageText(ctx.chat!.id, thinkingMsg.message_id, reply.text.slice(0, 4096), keyboard ? { reply_markup: keyboard } : undefined).catch(() => {})
    } else {
      await ctx.reply(reply.text.slice(0, 4096), keyboard ? { reply_markup: keyboard } : undefined).catch(() => {})
    }
  } catch (err) { console.error('[bot] /ai error:', err) }
})

bot.hears(/^!ai\b/, async (ctx) => {
  try {
    const query = ctx.message?.text?.replace(/^!ai\s*/, '').trim()
    if (!query) return
    if (process.env.ENABLE_AI_TAG_PROCESSING !== 'true') return
    const thinkingMsg = await ctx.reply('🤔…').catch(() => {})
    const reply = await adminAssistantChat(query, { source: 'bot', lang: ctx.config.lang })
    if (thinkingMsg) {
      await ctx.api.editMessageText(ctx.chat!.id, thinkingMsg.message_id, reply.text.slice(0, 4096)).catch(() => {})
    }
  } catch (err) { console.error('[bot] !ai error:', err) }
})

// ── URL detection handler (T-P0-1: extract URLs from text) ──
bot.on('message:text', async (ctx) => {
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
bot.on('message:photo', async (ctx) => {
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
bot.on('callback_query', async (ctx) => {
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
      const previewUrl = post.preview_key ? `${process.env.S3_EXTERNAL_URL || ''}/${post.preview_key}` : null
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
      if (process.env.ENABLE_AI_TAG_PROCESSING === 'true') {
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
