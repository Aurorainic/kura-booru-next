import { eq, inArray, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const cookie = getHeader(event, 'cookie') || ''
  const isAdmin = await getIsAdmin(cookie)
  if (!isAdmin) throw createError({ statusCode: 401, statusMessage: 'Admin required' })

  // ponytail: one-shot fix — artist tags were mis-categorized as 'general' by AI.
  // Source of truth is tag_knowledge.type='artist' (set either by AI classification that did
  // correctly identify artists in the cache, or by manual admin edit). Mirror that back onto tags.
  //
  // Also catches bare artist tags (no tag_knowledge row) by name pattern —
  // these are the ones the sidecar used to inject as "artist:xxx" string and pipeline
  // upserted as general. We fix them too and strip the "artist:" prefix from the name.

  const db_ = db

  // 1. Fix tags whose name appears in tag_knowledge with type='artist'
  const knowledgeArtists = await db_
    .select({ name: tagKnowledge.name })
    .from(tagKnowledge)
    .where(eq(tagKnowledge.type, 'artist'))

  let fixedFromKnowledge = 0
  if (knowledgeArtists.length) {
    const names = knowledgeArtists.map(r => r.name)
    const res = await db_
      .update(tags)
      .set({
        category: 'artist',
        aiProcessedAt: new Date(),
      })
      .where(inArray(tags.name, names))
      .returning({ id: tags.id })
    fixedFromKnowledge = res.length
  }

  // 2. Fix tags whose name still has the "artist:" prefix from the old sidecar flow.
  //    Two sub-cases per prefixed tag, after stripping "artist:":
  //      (a) a clean same-named tag already exists → this is a DUPLICATE.
  //          Move post_tags from the prefixed tag to the clean tag, ensure the clean
  //          tag is category=artist, then delete the prefixed tag (cascade drops its
  //          post_tags rows, but we've already moved the non-overlapping ones first).
  //          Posts already on both tags are skipped (PK dedup) — no data loss.
  //      (b) no clean counterpart → just rename in place + set category=artist.
  //    This is idempotent: a second run finds zero `artist:%` rows.
  const prefixed = await db_
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(sql`${tags.name} LIKE 'artist:%'`)

  let mergedIntoClean = 0
  let renamedInPlace = 0
  let postsMoved = 0

  for (const t of prefixed) {
    const stripped = t.name.replace(/^artist:/i, '').trim().toLowerCase()
    if (!stripped || stripped === t.name) continue

    const clean = await db_
      .select({ id: tags.id, category: tags.category })
      .from(tags)
      .where(eq(tags.name, stripped))
      .limit(1)

    if (clean[0]) {
      // (a) duplicate — merge prefixed INTO the clean tag
      const targetId = clean[0].id

      // Move post associations that aren't already on the target (raw SQL NOT IN, mirrors
      // /admin/tags/merge). (post_id, tag_id) PK guards against double-move.
      await db_.execute(sql`
        UPDATE post_tags SET tag_id = ${targetId}
        WHERE tag_id = ${t.id}
        AND post_id NOT IN (
          SELECT post_id FROM post_tags WHERE tag_id = ${targetId}
        )
      `)
      const movedRow = await db_.execute(sql`
        SELECT count(*) AS cnt FROM post_tags WHERE tag_id = ${targetId}
      `)
      const beforeRow = await db_.execute(sql`
        SELECT count(*) AS cnt FROM post_tags WHERE tag_id = ${t.id}
      `)
      // posts left on prefixed tag = overlapping (already on target) — they vanish with the delete
      const moved = Number(movedRow[0]?.cnt || 0) - Number(beforeRow[0]?.cnt || 0)
      postsMoved += Math.max(0, moved)

      // Ensure the clean tag is categorized as artist + recount
      await db_
        .update(tags)
        .set({
          category: 'artist' as any,
          aiProcessedAt: new Date(),
          postCount: sql`(SELECT count(*) FROM post_tags WHERE tag_id = ${targetId})`,
        })
        .where(eq(tags.id, targetId))

      // Delete the prefixed tag — its remaining (overlapping) post_tags rows cascade away
      await db_.delete(tags).where(eq(tags.id, t.id))
      mergedIntoClean++
    } else {
      // (b) no clean counterpart — rename in place + set category=artist
      await db_
        .update(tags)
        .set({
          name: stripped,
          category: 'artist' as any,
          aiProcessedAt: new Date(),
        })
        .where(eq(tags.id, t.id))
      renamedInPlace++
    }
  }

  return {
    fixed_from_knowledge: fixedFromKnowledge,
    merged_into_clean: mergedIntoClean,
    renamed_in_place: renamedInPlace,
    posts_moved: postsMoved,
    total_fixed: fixedFromKnowledge + mergedIntoClean + renamedInPlace,
  }
})
