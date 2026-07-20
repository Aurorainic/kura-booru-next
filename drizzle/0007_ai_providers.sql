-- v0.9.0: ai_providers — AI provider configs managed from the admin UI.
--
-- Moves AI provider configuration out of .env (AI_PROVIDER_API_KEY /
-- AI_PROVIDER_ENDPOINT / AI_PROVIDER_MODEL) into the database so providers can
-- be added / edited / enabled / disabled at runtime from the admin panel. The
-- env vars remain as an optional first-run seed (imported as a provider row
-- when the table is empty) and as the cold-start fallback before the first
-- config refresh.
--
-- Semantics: at most one enabled row = the active provider. The single-active
-- invariant is enforced in the admin API (enabling one row disables the rest),
-- not by a DB constraint, so the table stays writable from SQL in emergencies.
--
-- The global AI tag-processing switch lives in the settings KV table as key
-- `ai_tag_processing_enabled` ('true'/'false'); no DDL needed for it.
--
-- Hand-written (not drizzle-kit generate): drizzle/meta snapshots only cover
-- up to 0001 while 0002-0006 were hand-applied, so `generate` would emit a
-- spurious full diff. Follows the style of 0004_extension_keys.sql.
CREATE TABLE "ai_providers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(64) NOT NULL,
  "endpoint" text NOT NULL,
  "model" varchar(128) NOT NULL,
  "api_key" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ix_ai_providers_enabled" ON "ai_providers" USING btree ("enabled");
