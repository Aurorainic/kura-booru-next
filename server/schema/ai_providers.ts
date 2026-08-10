import { pgTable, uuid, varchar, text, boolean, timestamp, index } from 'drizzle-orm/pg-core'

// v0.9.0: ai_providers — AI provider configs managed from the admin UI.
// Replaces AI_PROVIDER_* env vars (now optional first-run seed/fallback).
// At most one row has enabled=true (enforced in admin API, not by DB constraint).
//
// SECURITY: api_key stored plaintext (DB is the trust boundary, like settings KV),
// but must NEVER leave the server in plaintext — admin GET endpoints return a
// masked preview only (maskApiKey), and getPublicSettings() must never include it.
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
