DROP INDEX "source_videos_ungeocoded_idx";--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "source_videos_ungeocoded_idx" ON "source_videos" USING btree ("geocoded_at") WHERE "source_videos"."geocoded_at" is null;