/**
 * Telegram Bot 代理/中转连接构建（v0.10.0）。
 *
 * 三种境内访问方式（settings 的 bot_proxy_type）：
 *   - http    → undici ProxyAgent（dispatcher）
 *   - socks   → socks-proxy-agent + undici Agent connect 包装
 *               （Node fetch 只认 dispatcher 不认 agent；secureEndpoint:true
 *                 让 socks 层完成 TLS，undici 只复用 socket）
 *   - mtproto → apiRoot（Telegram API 反代根地址）
 *   - ''      → 直连 api.telegram.org
 *
 * 注：undici 必须用 7.x（8.x 与 Node 24 内置 undici 不兼容：
 *     "invalid onRequestStart method"）。
 */
export function buildBotClient(
  proxyType: string,
  proxyUrl: string,
): Record<string, any> | undefined {
  if (!proxyUrl) return undefined
  const url = proxyUrl.replace(/\/+$/, '')

  if (proxyType === 'http') {
    const { ProxyAgent } = require('undici') as typeof import('undici')
    return { baseFetchConfig: { dispatcher: new ProxyAgent(url) } }
  }

  if (proxyType === 'socks') {
    const { Agent } = require('undici') as typeof import('undici')
    const { SocksProxyAgent } = require('socks-proxy-agent') as typeof import('socks-proxy-agent')
    const { EventEmitter } = require('node:events')
    const socks = new SocksProxyAgent(url)
    const fakeReq = new EventEmitter()
    const dispatcher = new Agent({
      connect: (options: any, callback: any) => {
        socks.connect(fakeReq, {
          host: options.hostname || options.host,
          port: options.port || 443,
          secureEndpoint: true,
        }).then(
          (socket: any) => callback(null, socket),
          (err: Error) => callback(err, null),
        )
      },
    })
    return { baseFetchConfig: { dispatcher } }
  }

  // mtproto（及历史遗留：无类型时当 apiRoot 用）
  return { apiRoot: url }
}
