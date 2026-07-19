/**
 * phash dedup step — shared by single-image and multi-image paths.
 *
 * Uses the ix_posts_phash_prefix expression index (R2.1) for the bucket
 * lookup, then findDuplicateByPhash for Hamming-distance comparison.
 *
 * Returns the existing post ID if a duplicate is found, null otherwise.
 */
import { sql } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { posts } from '../../../schema/posts'
import { findDuplicateByPhash } from '../../../utils/phash'

export async function checkDuplicate(phash: string): Promise<string | null> {
  if (!phash || !/^[0-9a-f]+$/i.test(phash) || phash.length < 4) return null

  const prefix = phash.slice(0, 4)
  const candidates = await db
    .select({ id: posts.id, phash: posts.phash })
    .from(posts)
    .where(sql`left(${posts.phash}, 4) = ${prefix}`)

  return findDuplicateByPhash(
    candidates as { id: string; phash: string }[],
    phash,
  )
}
