/**
 * Telegram Bot 代理/中转连接构建（v0.10.0）。三种境内访问方式（settings bot_proxy_type）：
 * http → undici ProxyAgent；socks → socks-proxy-agent + undici Agent connect 包装
 * （Node fetch 只认 dispatcher；secureEndpoint:true 让 socks 层完成 TLS）；mtproto → apiRoot。
 * 注：undici 必须用 7.x（8.x 与 Node 24 内置 undici 不兼容："invalid onRequestStart method"）。
 */
import { ProxyAgent, Agent } from 'undici'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { EventEmitter } from 'node:events'

export function buildBotClient(
  proxyType: string,
  proxyUrl: string,
): Record<string, any> | undefined {
  if (!proxyUrl) return undefined
  const url = proxyUrl.replace(/\/+$/, '')

  if (proxyType === 'http') {
    return { baseFetchConfig: { dispatcher: new ProxyAgent(url) } }
  }

  if (proxyType === 'socks') {
    const socks = new SocksProxyAgent(url)
    const fakeReq = new EventEmitter() as any
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
  if (proxyType === 'mtproto' || proxyType === '') {
    return { apiRoot: url }
  }

  // H5: 未知类型（typo 如 'htp'）一律直连 — 不把 typo URL 当 apiRoot，
  // 否则 bot token + 全部回调会发往攻击者服务器。
  console.warn(`[bot-proxy] unknown proxy_type "${proxyType}", falling back to direct connection`)
  return undefined
}
