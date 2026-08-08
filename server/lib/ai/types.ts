// v0.9.0 R2.5: split from server/utils/ai.ts. Shared types for the AI module.

import type { Rating, TagCategory } from '../../platform/schemas/enums'

// ── Types ──

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TagClassification {
  name: string
  category: TagCategory
  translation: string
  danbooru_name: string
  confidence: number
  /** 来源标记（manual=人工纠偏 / ai=AI 分类），用于知识合并优先级，非持久化字段 */
  _source?: string
}

export interface AiJobStatus {
  id: string
  type: 'classify' | 'merges' | 'ratings'
  status: 'running' | 'done' | 'error' | 'gone'
  total: number
  done: number
  errors: string[]
  started_at: number
  result?: any
}

export interface MergeSuggestion {
  canonical_name: string
  aliases: string[]
  reason: string
  confidence: number
}

export interface RatingSuggestion {
  rating: Rating
  confidence: number
  reason: string
}
