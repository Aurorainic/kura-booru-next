import { eq, inArray, sql } from 'drizzle-orm'
import { defineAdminHandler } from '../../../../platform/http/auth'

export default defineAdminHandler({
  doc: { method: 'post', path: '/api/admin/tags/fix-artist-categories', summary: 'Fix artist tag categories' },
  handler: async () => {
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

    // 2. Fix "artist:"-prefixed tags (old sidecar flow): (a) clean same-named tag exists →
    //    duplicate: move post_tags to it, set category=artist, delete prefixed tag (overlaps
    //    skipped by PK dedup — no data loss); (b) else rename in place. Idempotent: second
    //    run finds zero `artist:%` rows.
    const prefixed = await db_
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(sql`${tags.name} LIKE 'artist:%'`)

    // H12: 预取所有 stripped 名的 clean 对照（一次 IN 查询），循环内不再逐条 SELECT
    const strippedNames = prefixed
      .map(t => t.name.replace(/^artist:/i, '').trim().toLowerCase())
      .filter(n => n)
    const cleanRows = strippedNames.length
      ? await db_
          .select({ id: tags.id, name: tags.name, category: tags.category })
          .from(tags)
          .where(inArray(tags.name, [...new Set(strippedNames)]))
      : []
    const cleanByName = new Map(cleanRows.map(c => [c.name, c]))

    let mergedIntoClean = 0
    let renamedInPlace = 0
    let postsMoved = 0

    for (const t of prefixed) {
      const stripped = t.name.replace(/^artist:/i, '').trim().toLowerCase()
      if (!stripped || stripped === t.name) continue

      const clean = cleanByName.get(stripped)

      if (clean) {
        // (a) duplicate — merge prefixed INTO the clean tag
        const targetId = clean.id

        // Move post associations not already on the target (raw SQL NOT IN, mirrors
        // /admin/tags/merge); (post_id, tag_id) PK guards double-move.
        // H12: affected-rows = actually moved count, replaces 2 count(*) scans.
        const moveRes = await db_.execute(sql`
          UPDATE post_tags SET tag_id = ${targetId}
          WHERE tag_id = ${t.id}
          AND post_id NOT IN (
            SELECT post_id FROM post_tags WHERE tag_id = ${targetId}
          )
        `)
        // postgres-js PostgresResult.count = 受影响行数（drizzle 透传，库边界形状）
        const moved = Number((moveRes as unknown as { count?: number }).count || 0)
        postsMoved += moved

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
  },
})
