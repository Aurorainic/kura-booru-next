import { defineAdminHandler } from '../../../../platform/http/auth'

// 用实际下载链路常访问的 Pixiv 域名做连通性探测；任何 HTTP 状态都算代理可用。
const TEST_URL = 'https://www.pixiv.net'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/settings/test-dl-proxy', summary: 'Test download proxy connection' },
  handler: async ({ event }) => {
    const { getDlProxyConfig } = await import('../../../../utils/settings')
    const { buildBotClient } = await import('../../../../utils/bot-proxy')
    const body = (await readBody<{ proxyType?: string; proxyUrl?: string }>(event).catch(() => ({}))) as { proxyType?: string; proxyUrl?: string }
    const saved = await getDlProxyConfig()
    const proxyType = (body?.proxyType ?? saved.proxyType ?? '').trim()
    const proxyUrl = (body?.proxyUrl || saved.proxyUrl || '').trim()

    if (!proxyUrl) return { ok: false, error: '下载代理地址未配置' }
    if (proxyType !== 'http' && proxyType !== 'socks') {
      return { ok: false, error: '下载代理类型仅支持 HTTP(S) 或 SOCKS5' }
    }

    // 与 sidecar load_dl_proxy 保持一致：socks 类型允许填 http:// 或裸地址，
    // 实际测试时统一转成 socks5://。
    let testProxyUrl = proxyUrl
    if (proxyType === 'socks' && !/^socks/i.test(testProxyUrl)) {
      const host = testProxyUrl.includes('://') ? testProxyUrl.split('://')[1] : testProxyUrl
      testProxyUrl = `socks5://${host}`
    }

    try {
      const parsed = new URL(testProxyUrl)
      const allowed = proxyType === 'http'
        ? ['http:', 'https:']
        : ['socks:', 'socks4:', 'socks4a:', 'socks5:']
      if (!allowed.includes(parsed.protocol)) {
        return { ok: false, error: '下载代理地址协议与所选类型不匹配' }
      }
      // M7: 与 test-bot 一致 — 代理地址指向私网/回环时拒绝（防止探测请求打到
      // 内网资产，SSRF 的代理形态）。
      const { isPrivateHost } = await import('../../../../utils/settings')
      if (!parsed.hostname || await isPrivateHost(parsed.hostname)) {
        return { ok: false, error: '下载代理地址不能指向私网/回环地址' }
      }
    } catch {
      return { ok: false, error: '下载代理地址不是有效 URL' }
    }

    const client = buildBotClient(proxyType, testProxyUrl)
    const dispatcher = client?.baseFetchConfig?.dispatcher
    if (!dispatcher) return { ok: false, error: '无法构建下载代理连接' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const { fetch: proxyFetch } = await import('undici')
      const resp = await proxyFetch(TEST_URL, { dispatcher, signal: controller.signal, redirect: 'manual' })
      return { ok: true, via: `${proxyType} ${proxyUrl}`, status: resp.status }
    } catch (err: any) {
      return { ok: false, error: err?.message || '连接失败' }
    } finally {
      clearTimeout(timer)
    }
  },
})
