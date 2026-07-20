import { pgTable, uuid, varchar, text, boolean, timestamp, index } from 'drizzle-orm/pg-core'

// v0.9.0: ai_providers — AI provider configs managed from the admin UI.
// Replaces the AI_PROVIDER_* env vars (now an optional first-run seed/fallback).
// Semantics: at most one row has enabled=true — that row is the active provider.
// The single-active invariant is enforced in the admin API (enabling one row
// disables the rest), not by a DB constraint.
//
// SECURITY: api_key is stored in plaintext (the DB is the trust boundary, same
// as settings KV), but it must NEVER leave the server in plaintext — admin GET
// endpoints return a masked preview only (see maskApiKey in lib/ai/config.ts),
// and getPublicSettings() must never include it.
export const aiProviders = pgTable('ai_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 64 }).notNull(),
  endpoint: text('endpoint').notNull(),
  model: varchar('model', { length: 128 }).notNull(),
  apiKey: text('api_key').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  enabledIdx: index('ix_ai_providers_enabled').on(t.enabled),
}))
