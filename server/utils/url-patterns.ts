/**
 * URL pattern matching for source site identification — TS port of Python _patterns.py.
 * When adding a new site, add patterns here and update the SourceSite enum.
 */

const PIXIV_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?pixiv\.net\/(?:artworks|illust)\/(\d+)/i,
  /(?:https?:\/\/)?(?:www\.)?pixiv\.net\/member_illust\.php\?.*illust_id=(\d+)/i,
  /(?:https?:\/\/)?(?:www\.)?pixiv\.net\/i\/(\d+)/i,
  /(?:https?:\/\/)?(?:www\.)?phixiv\.net\/(?:artworks|illust)\/(\d+)/i,
]

const PHIXIV_NORMALIZE = /https?:\/\/(?:www\.)?phixiv\.net/i

const TWITTER_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/i,
]

const DANBOORU_PATTERNS = [
  /(?:https?:\/\/)?(?:danbooru\.donmai\.us|safebooru\.donmai\.us)\/posts\/(\d+)/i,
]

export function identifySource(url: string): { site: string; id: string } | null {
  const normalized = url.replace(PHIXIV_NORMALIZE, 'https://www.pixiv.net')

  for (const pattern of PIXIV_PATTERNS) {
    const match = normalized.match(pattern)
    if (match && match[1]) return { site: 'pixiv', id: match[1] }
  }

  for (const pattern of TWITTER_PATTERNS) {
    const match = normalized.match(pattern)
    if (match && match[2]) return { site: 'twitter', id: match[2] }
  }

  for (const pattern of DANBOORU_PATTERNS) {
    const match = normalized.match(pattern)
    if (match && match[1]) return { site: 'danbooru', id: match[1] }
  }

  return null
}

export function resolveSourceOrOther(url: string): { site: string; id: string } {
  const result = identifySource(url)
  if (result) return result

  try {
    const parsed = new URL(url)
    const pathId = parsed.pathname.replace(/^\//, '').replace(/\//g, '_') || 'unknown'
    return { site: 'other', id: `${parsed.hostname}_${pathId}` }
  } catch {
    return { site: 'other', id: 'unknown' }
  }
}
