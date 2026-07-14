CREATE TABLE "extension_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(64) NOT NULL,
  "key_hash" varchar(64) NOT NULL UNIQUE,
  "key_prefix" varchar(12) NOT NULL,
  "created_by" text NOT NULL,
  "can_force_rating" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "ix_extension_keys_active" ON "extension_keys" USING btree ("revoked_at","created_at");