CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";--> statement-breakpoint
CREATE TYPE "public"."rating" AS ENUM('safe', 'questionable', 'explicit');--> statement-breakpoint
CREATE TYPE "public"."source_site" AS ENUM('pixiv', 'twitter', 'danbooru', 'other');--> statement-breakpoint
CREATE TYPE "public"."tag_category" AS ENUM('artist', 'character', 'copyright', 'general', 'meta');--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"s3_key" text NOT NULL,
	"thumb_key" text NOT NULL,
	"preview_key" text NOT NULL,
	"source_url" text NOT NULL,
	"source_site" "source_site" NOT NULL,
	"source_id" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"phash" text NOT NULL,
	"title" text,
	"description" text,
	"rating" "rating" DEFAULT 'safe' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_tag_processed_at" timestamp with time zone,
	"ai_tag_status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" "tag_category" NOT NULL,
	"post_count" integer DEFAULT 0 NOT NULL,
	"danbooru_name" text,
	"translation" text,
	"ai_processed_at" timestamp with time zone,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "post_tags" (
	"post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "post_tags_post_id_tag_id_pk" PRIMARY KEY("post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tag_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alias_name" text NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "tag_aliases_alias_name_unique" UNIQUE("alias_name")
);
--> statement-breakpoint
CREATE TABLE "tag_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"danbooru_name" text,
	"type" text NOT NULL,
	"translation" text,
	"source" text DEFAULT 'ai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_knowledge_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "auto_rating_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag_name" text NOT NULL,
	"target_rating" "rating" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_rating_rules_tag_name_unique" UNIQUE("tag_name")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_aliases" ADD CONSTRAINT "tag_aliases_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_posts_source_site_id" ON "posts" USING btree ("source_site","source_id");--> statement-breakpoint
CREATE INDEX "ix_posts_created_at" ON "posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_posts_rating" ON "posts" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "ix_posts_phash" ON "posts" USING btree ("phash");--> statement-breakpoint
CREATE INDEX "ix_posts_title_trgm" ON "posts" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_tags_name_trgm" ON "tags" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_tags_translation_trgm" ON "tags" USING gin ("translation" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_tags_danbooru_name_trgm" ON "tags" USING gin ("danbooru_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ix_tags_post_count" ON "tags" USING btree ("post_count");--> statement-breakpoint
CREATE UNIQUE INDEX "ix_tag_knowledge_name" ON "tag_knowledge" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "ix_auto_rating_rules_tag_name" ON "auto_rating_rules" USING btree ("tag_name");--> statement-breakpoint
CREATE UNIQUE INDEX "ix_admins_username" ON "admins" USING btree ("username");