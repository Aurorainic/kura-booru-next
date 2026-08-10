/**
 * Tag upsert step — shared by single-image and multi-image paths.
 * Bulk upserts in one statement, postCount++ for new and existing rows;
 * artist tag gets a dedicated upsert with category=artist.
 * Returns the tag IDs (for post_tags associations and AI tag processing).
 */
import { sql } from 'drizzle-orm'
import { tags } from '../../../schema/tags'

export async function upsertTags(
  tx: any,
  tagNames: string[],
  artistName: string,
): Promise<string[]> {
  const tagIds: string[] = []

  const cleanNames: string[] = []
  let extractedArtist = artistName
  for (const raw of tagNames) {
    const name = (raw || '').trim()
    if (!name) continue
    if (name.startsWith('artist:')) {
      const bare = name.slice('artist:'.length).trim()
      if (bare && !extractedArtist) extractedArtist = bare
      continue  // 前缀标签不进入普通标签
    }
    cleanNames.push(name)
  }

  if (cleanNames.length > 0) {
    const rows = await tx.insert(tags)
      .values(cleanNames.map(name => ({ name, category: 'general' as any, postCount: 1 })))
      .onConflictDoUpdate({
        target: tags.name,
        set: { postCount: sql`${tags.postCount} + 1` },
      })
      .returning({ id: tags.id, name: tags.name })
    for (const r of rows) tagIds.push(r.id)
  }

  // Artist tag: dedicated upsert with category=artist
  if (extractedArtist) {
    const [tag] = await tx
      .insert(tags)
      .values({ name: extractedArtist, category: 'artist' as any, postCount: 1 })
      .onConflictDoUpdate({
        target: tags.name,
        set: {
          postCount: sql`${tags.postCount} + 1`,
          // Fix mis-categorized artist tags in place
          category: 'artist' as any,
          aiProcessedAt: new Date(),
        },
      })
      .returning({ id: tags.id })
    if (tag?.id && !tagIds.includes(tag.id)) tagIds.push(tag.id)
  }

  return tagIds
}

/**
 * Bulk insert post_tags associations (idempotent via ON CONFLICT DO NOTHING).
 */
import { postTags } from '../../../schema/post_tags'

export async function associateTags(tx: any, postId: string, tagIds: string[]): Promise<void> {
  if (tagIds.length > 0) {
    await tx.insert(postTags)
      .values(tagIds.map(tid => ({ postId, tagId: tid })))
      .onConflictDoNothing()
  }
}
