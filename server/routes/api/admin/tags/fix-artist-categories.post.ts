import { eq, sql, inArray } from 'drizzle-orm'

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
  //    Strip the prefix and set category=artist. If the stripped name collides with an existing
  //    tag, we leave the duplicate for the admin to merge (don't silently destroy data).
  const prefixed = await db_
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(sql`${tags.name} LIKE 'artist:%'`)

  let fixedPrefixed = 0
  for (const t of prefixed) {
    const stripped = t.name.replace(/^artist:/i, '').trim().toLowerCase()
    if (!stripped || stripped === t.name) continue
    try {
      await db_
        .update(tags)
        .set({
          name: stripped,
          category: 'artist',
          aiProcessedAt: new Date(),
        })
        .where(eq(tags.id, t.id))
      fixedPrefixed++
    } catch (e: any) {
      // Likely unique-constraint collision — the canonical tag already exists.
      // Skip; admin should merge via /admin/tags/merge.
      console.warn(`[fix-artist-categories] skip ${t.name} → ${stripped}:`, e.message)
    }
  }

  return {
    fixed_from_knowledge: fixedFromKnowledge,
    fixed_prefixed: fixedPrefixed,
    total_fixed: fixedFromKnowledge + fixedPrefixed,
  }
})
