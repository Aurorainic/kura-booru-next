// v0.9.0 R2.5: split from server/utils/ai.ts. Post summary for Bot /info (capability ⑥).

import { callAi } from './client'

// ── Post summary for Bot /info (capability ⑥) ──

export async function generatePostSummary(post: any): Promise<string> {
  const tagNames = (post.tags || []).map((t: any) => t.name).join(', ')
  const translations = (post.tags || []).map((t: any) => t.translation).filter(Boolean).join(', ')

  // ponytail: twitter posts often have no title/description. Without this
  // guard, the AI gets "标题: (无)\n描述: \n标签: " and hallucinates nonsense.
  if (!tagNames && !post.title && !post.description) {
    return '无标题、描述及标签的图片'
  }

  const raw = await callAi([
    {
      role: 'system',
      content: '你是一个动漫图片摘要生成器。根据标题、描述、标签生成一句话中文摘要（不超过80字）。只返回摘要文本，不要加引号或前缀。如果信息不足，返回"信息不足，无法生成摘要"。',
    },
    {
      role: 'user',
      content: `标题: ${post.title || '(无)'}\n描述: ${(post.description || '').slice(0, 200)}\n标签: ${tagNames || '(无)'}\n中文翻译: ${translations || '(无)'}`,
    },
  ], { temperature: 0.5 })
  return raw.trim()
}
