import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core'

// v0.7.8: extension_keys — admin-generated API keys for the browser extension.
// Distinct from BACKEND_API_KEY (service-level, shared with bot): each key is
// owned by a single admin and can be individually revoked. Raw key value
// (`kb_ext_` + 32 chars base62) is shown once on creation; only sha256 hash
// is persisted. Mirrors GitHub PAT model.
export const extensionKeys = pgTable('extension_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 64 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => ({
  activeIdx: index('ix_extension_keys_active').on(t.revokedAt, t.createdAt),
}))