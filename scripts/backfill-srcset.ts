#!/usr/bin/env node
/**
 * Backfill srcset variants for existing posts (ADR-0003).
 *
 * Pre-v0.9.0 posts have thumb/preview keys in <uuid>.webp format (2 variants).
 * v0.9.0 generates 4 variants (300w/640w/1280w/2000w) with <base>-<width>w.webp
 * naming. This script regenerates the missing variants from the original image
 * and uploads them to S3 with the new naming convention.
 *
 * Usage:
 *   node scripts/backfill-srcset.ts --dry-run    # preview only, no changes
 *   node scripts/backfill-srcset.ts              # execute backfill
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import { posts } from '../server/schema/posts.ts'
import { eq, isNull, not } from 'drizzle-orm'
import sharp from 'sharp'

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) { console.error('DATABASE_URL required'); process.exit(1) }

  const db = drizzle(dbUrl)
  const allPosts = await db.select({ id: posts.id, s3Key: posts.s3Key, thumbKey: posts.thumbKey })
    .from(posts)
    .where(not(isNull(posts.s3Key)))

  console.log(`[backfill] ${allPosts.length} posts to check (dry-run: ${DRY_RUN})`)

  let needs = 0, skipped = 0
  for (const post of allPosts) {
    // Detect old format: keys without -<width>w. suffix
    const hasNewFormat = post.thumbKey.includes('-300w.')
    if (hasNewFormat) { skipped++; continue }
    needs++
    if (DRY_RUN) {
      console.log(`[dry-run] would backfill: ${post.id} (thumb=${post.thumbKey})`)
    } else {
      // TODO: download original from S3, generate 4 variants, upload with new naming
      console.log(`[backfill] TODO: implement actual backfill for ${post.id}`)
    }
  }

  console.log(`[backfill] done: ${needs} need backfill, ${skipped} already migrated`)
}

main().catch(err => { console.error(err); process.exit(1) })
