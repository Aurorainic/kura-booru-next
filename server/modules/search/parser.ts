import type { Rating } from '~/types'

// ── Search query parsing ──

export interface ParsedQuery {
  includeTags: string[]
  excludeTags: string[]
  rating?: Rating
  sourceSite?: string
  unresolved: string[]
}

export function parseSearchQuery(q: string): ParsedQuery {
  const result: ParsedQuery = { includeTags: [], excludeTags: [], unresolved: [] }
  const tokens = q.split(/[+\s]+/).filter(Boolean)

  for (const token of tokens) {
    // rating:value
    const ratingMatch = token.match(/^rating:(safe|s|questionable|q|explicit|e)$/i)
    if (ratingMatch) {
      const map: Record<string, Rating> = { s: 'safe', q: 'questionable', e: 'explicit' }
      const matched = ratingMatch[1]?.toLowerCase() || ''
      result.rating = map[matched] || matched as Rating
      continue
    }

    // source:value
    const sourceMatch = token.match(/^source:(pixiv|twitter|danbooru|other)$/i)
    if (sourceMatch) {
      result.sourceSite = sourceMatch[1]?.toLowerCase()
      continue
    }

    // -exclude
    if (token.startsWith('-')) {
      result.excludeTags.push(token.slice(1).toLowerCase())
      continue
    }

    // include tag
    result.includeTags.push(token.toLowerCase())
  }

  return result
}
