// v0.9.0 R2.5: split from server/utils/ai.ts. Shared types for the AI module.

import type { Rating, TagCategory } from '~/types'

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
}

export interface AiJobStatus {
  id: string
  type: 'classify' | 'merges' | 'ratings'
  status: 'running' | 'done' | 'error'
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

export interface AssistantSuggestion {
  label: string
  callback_data: string
  action?: { type: string; payload: any }
}

export interface AssistantReply {
  text: string
  suggestions?: AssistantSuggestion[]
}
