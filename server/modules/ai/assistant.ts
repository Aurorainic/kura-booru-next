// v0.9.0 R2.5: split from server/utils/ai.ts. Admin assistant chat (capability ④ + ⑧).

import { eq, sql, isNull } from 'drizzle-orm'
import { db } from '../../utils/db'
import { posts, tags } from '../../schema'
import { callAi } from './client'
import type { AiMessage, AssistantReply } from './types'

// ── Admin assistant chat (capability ④ + ⑧) ──

const ASSISTANT_SYSTEM_PROMPT = `You are an AI assistant for a booru-style anime image gallery management system (Kura Booru). You help the admin manage tags, posts, and ratings.

You have access to the following real-time database statistics, which are provided in the context section of each user message:
- Total posts, total tags, unprocessed tags, tags missing translation, posts pending AI processing, safe-rated posts percentage

Available actions you can suggest (as clickable buttons):
- "分类未处理标签" — Classify unprocessed tags into categories with Chinese translations
- "扫描合并建议" — Find tags that should be merged
- "扫描评级建议" — Review post ratings for accuracy

When the admin asks a question:
1. Answer in Chinese (the admin interface is in Chinese)
2. Use the database statistics in the context to answer factual questions about the gallery state
3. If the admin asks about something the context doesn't cover (e.g. "how many explicit posts?"), be honest that you only have aggregate counts and suggest they check the admin panel
4. If the admin's question implies an action, suggest the relevant action button
5. Keep responses concise and practical

Return JSON: { "text": "your Chinese response", "suggestions": [{ "label": "按钮文字", "callback_data": "natural language query to send back" }] }

Important:
- callback_data should be a short natural-language query that, when sent back to you, will trigger the action (e.g. "分类未处理的标签" or "扫描合并建议")
- suggestions is optional - only include when the admin might want to take an action
- Do NOT claim you can query individual tags or posts - you only have aggregate statistics`

export async function adminAssistantChat(
  query: string,
  context: { source: 'web' | 'bot'; lang?: string; history?: AiMessage[] },
): Promise<AssistantReply> {
  // Gather DB context for the query
  const dbContext = await gatherAssistantContext(query)

  const messages: AiMessage[] = [
    { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
  ]

  if (context.history?.length) {
    messages.push(...context.history)
  }

  messages.push({
    role: 'user',
    content: `Context: ${dbContext}\n\nQuestion: ${query}\nSource: ${context.source}\nLanguage: ${context.lang || 'zh'}`,
  })

  const raw = await callAi(messages, { json: true, temperature: 0.4 })

  try {
    const parsed = JSON.parse(raw)
    return {
      text: String(parsed.text || ''),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 8) : undefined,
    }
  } catch {
    // Fallback: treat raw as plain text
    return { text: raw.slice(0, 2000) }
  }
}

async function gatherAssistantContext(query: string): Promise<string> {
  const parts: string[] = []

  try {
    const [postCount, tagCount, unprocessedCount, missingTranslationCount, pendingPostCount, safeCount, qCount, eCount, charCount, artistCount, copyrightCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(posts),
      db.select({ count: sql<number>`count(*)` }).from(tags),
      db.select({ count: sql<number>`count(*)` }).from(tags).where(isNull(tags.aiProcessedAt)),
      db.select({ count: sql<number>`count(*)` }).from(tags).where(sql`${tags.translation} IS NULL OR ${tags.translation} = ''`),
      db.select({ count: sql<number>`count(*)` }).from(posts).where(isNull(posts.aiTagStatus)),
      db.select({ count: sql<number>`count(*)` }).from(posts).where(eq(posts.rating, 'safe')),
      db.select({ count: sql<number>`count(*)` }).from(posts).where(eq(posts.rating, 'questionable')),
      db.select({ count: sql<number>`count(*)` }).from(posts).where(eq(posts.rating, 'explicit')),
      db.select({ count: sql<number>`count(*)` }).from(tags).where(eq(tags.category, 'character')),
      db.select({ count: sql<number>`count(*)` }).from(tags).where(eq(tags.category, 'artist')),
      db.select({ count: sql<number>`count(*)` }).from(tags).where(eq(tags.category, 'copyright')),
    ])

    const totalPosts = Number(postCount[0]?.count || 0)
    const safeNum = Number(safeCount[0]?.count || 0)
    const safePct = totalPosts ? Math.round((safeNum / totalPosts) * 100) : 0

    // ponytail: query-aware context. The previous version always returned the
    // same 6 counts regardless of what the admin asked - if they asked "how
    // many explicit posts?", the context didn't include that number, so the
    // AI had to guess or deflect. Now we always provide the full breakdown so
    // the AI can answer any stats question from context.
    parts.push(`Database statistics:`)
    parts.push(`- Total posts: ${totalPosts} (safe: ${safeNum} (${safePct}%), questionable: ${Number(qCount[0]?.count || 0)}, explicit: ${Number(eCount[0]?.count || 0)})`)
    parts.push(`- Total tags: ${Number(tagCount[0]?.count || 0)} (artist: ${Number(artistCount[0]?.count || 0)}, character: ${Number(charCount[0]?.count || 0)}, copyright: ${Number(copyrightCount[0]?.count || 0)})`)
    parts.push(`- Unprocessed tags (no AI classification): ${Number(unprocessedCount[0]?.count || 0)}`)
    parts.push(`- Tags missing Chinese translation: ${Number(missingTranslationCount[0]?.count || 0)}`)
    parts.push(`- Posts pending AI tag processing: ${Number(pendingPostCount[0]?.count || 0)}`)
  } catch { /* ignore */ }

  return parts.join('\n')
}
