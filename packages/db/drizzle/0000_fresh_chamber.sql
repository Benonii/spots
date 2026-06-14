CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"platform" text DEFAULT 'tiktok' NOT NULL,
	"url" text NOT NULL,
	"display_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_scraped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"spot_id" uuid,
	"platform_video_id" text NOT NULL,
	"url" text NOT NULL,
	"caption" text,
	"hashtags" text[] DEFAULT '{}' NOT NULL,
	"view_count" bigint,
	"like_count" bigint,
	"comment_count" bigint,
	"share_count" bigint,
	"posted_at" timestamp with time zone,
	"thumbnail_url" text,
	"top_comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extraction" jsonb,
	"geo" jsonb,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"normalized_at" timestamp with time zone,
	CONSTRAINT "source_videos_platform_video_id_unique" UNIQUE("platform_video_id")
);
--> statement-breakpoint
ALTER TABLE "source_videos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "spots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_place_id" text NOT NULL,
	"name" text NOT NULL,
	"neighborhood" text,
	"address" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"price_min" numeric,
	"price_max" numeric,
	"price_currency" text DEFAULT 'ETB' NOT NULL,
	"price_basis" text DEFAULT 'unknown' NOT NULL,
	"price_level" smallint,
	"quality_score" numeric DEFAULT '0' NOT NULL,
	"quality_signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"summary" text,
	"video_count" integer DEFAULT 0 NOT NULL,
	"cover_image_url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spots_google_place_id_unique" UNIQUE("google_place_id"),
	CONSTRAINT "spots_price_basis_check" CHECK ("spots"."price_basis" in ('per_person','total','unknown')),
	CONSTRAINT "spots_price_level_check" CHECK ("spots"."price_level" between 1 and 4)
);
--> statement-breakpoint
ALTER TABLE "spots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_videos" ADD CONSTRAINT "source_videos_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_videos" ADD CONSTRAINT "source_videos_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."spots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_videos_spot_idx" ON "source_videos" USING btree ("spot_id");--> statement-breakpoint
CREATE INDEX "source_videos_unnormalized_idx" ON "source_videos" USING btree ("normalized_at") WHERE "source_videos"."normalized_at" is null;--> statement-breakpoint
CREATE INDEX "source_videos_ungeocoded_idx" ON "source_videos" USING btree ("geo") WHERE "source_videos"."extraction" is not null and "source_videos"."geo" is null;--> statement-breakpoint
CREATE INDEX "spots_quality_idx" ON "spots" USING btree ("quality_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "spots_price_level_idx" ON "spots" USING btree ("price_level");--> statement-breakpoint
CREATE INDEX "spots_neighborhood_idx" ON "spots" USING btree ("neighborhood");--> statement-breakpoint
CREATE INDEX "spots_tags_idx" ON "spots" USING gin ("tags");--> statement-breakpoint
CREATE POLICY "public read spots" ON "spots" AS PERMISSIVE FOR SELECT TO "anon" USING (true);