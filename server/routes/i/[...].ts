function isPathSafe(key: string): boolean {
  // Prevent path traversal: reject empty/absolute/backslash/%/control keys and
  // '.'/'..' components (valid S3 keys here are UUIDs, so % never occurs).
  if (!key || key === '/' || key.startsWith('/') || /[\\%\u0000-\u001f\u007f]/.test(key)) return false
  const parts = key.split('/')
  for (const part of parts) {
    if (part === '..' || part === '.') return false
  }
  return true
}

// H16: key → 文件大小缓存（S3 key 是 UUID，上传后不可变，缓存安全）。
// 上限 1000 条按插入序淘汰。
const fileSizeCache = new Map<string, number>()

async function getFileSize(targetUrl: string): Promise<number | null> {
  const cached = fileSizeCache.get(targetUrl)
  if (cached !== undefined) return cached
  try {
    const head = await fetch(targetUrl, { method: 'HEAD' })
    const len = Number(head.headers.get('content-length') || 0)
    if (len > 0) {
      if (fileSizeCache.size >= 1000) {
        const oldest = fileSizeCache.keys().next().value
        if (oldest !== undefined) fileSizeCache.delete(oldest)
      }
      fileSizeCache.set(targetUrl, len)
      return len
    }
  } catch {
    // HEAD 失败 — 调用方回退到原样转发
  }
  return null
}

/**
 * H16: 规范化 Range header — 畸形值原样转发给 S3 会得到 416/502 且信息被吞。
 * 重写为 bytes=start-end（end 钳制到 fileSize-1，start 越界交给 S3 返回 416）；非法语法丢弃。
 */
async function normalizeRange(range: string, targetUrl: string): Promise<string | null> {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!m || (!m[1] && !m[2])) return null
  if (!m[1]) return `bytes=-${m[2]}` // suffix range — 合法，原样保留
  const start = parseInt(m[1], 10)
  const fileSize = await getFileSize(targetUrl)
  if (fileSize === null) return `bytes=${start}-${m[2] || ''}` // 拿不到大小：原样（超限交给 S3 416）
  if (start >= fileSize) return `bytes=${start}-` // 越界 start — 保持 416 语义
  const end = m[2] ? Math.min(parseInt(m[2], 10), fileSize - 1) : fileSize - 1
  return `bytes=${start}-${end}`
}

export default defineEventHandler(async (event) => {
  const key = event.path.replace(/^\/i\/?/, '')

  if (!isPathSafe(key)) {
    return new Response('Forbidden', { status: 403 })
  }

  // 断网闭环：/i/ 代理必须用「web 容器视角」的 S3 endpoint（本机部署 = host.docker.internal），
  // 而非 s3_external_url —— 后者配 DHCP IP 时断网即消失，图片全部 502。
  const { getS3Config } = await import('../../utils/settings')
  const cfg = await getS3Config()
  if (!cfg.endpoint) {
    return new Response('S3 endpoint not configured', { status: 502 })
  }
  const s3Base = `${cfg.endpoint.replace(/\/+$/, '')}/${cfg.bucket}`
  const targetUrl = `${s3Base}/${key}`

  // Forward Range so S3 returns 206 partial content for image seeks and video
  // previews.
  const reqHeaders: Record<string, string> = {}
  const range = getRequestHeader(event, 'range')
  if (range) {
    const normalized = await normalizeRange(range, targetUrl)
    if (normalized) reqHeaders['Range'] = normalized
  }

  try {
    const resp = await fetch(targetUrl, { headers: reqHeaders })
    if (!resp.ok && resp.status !== 206) return new Response('S3 error', { status: resp.status })
    const outHeaders: Record<string, string> = {
      'content-type': resp.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000',
    }
    for (const h of ['content-range', 'accept-ranges', 'content-length']) {
      const v = resp.headers.get(h)
      if (v) outHeaders[h] = v
    }
    return new Response(resp.body, {
      status: resp.status,
      headers: outHeaders,
    })
  } catch (e: any) {
    console.error('[i-proxy]', e?.message || e)
    return new Response('S3 unreachable: ' + (e?.message || 'unknown'), { status: 502 })
  }
})
