-- v0.9.0: AI provider configs moved from .env into the DB (admin-managed);
-- env vars remain as first-run seed + cold-start fallback. Single-active
-- provider enforced in admin API (not a DB constraint) so SQL stays writable
-- in emergencies. Global switch is settings KV `ai_tag_processing_enabled`.
-- Hand-written: drizzle-kit generate would emit a spurious diff.
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
