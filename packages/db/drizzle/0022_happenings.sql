-- happenings — time-bound events scraped from Telegram (t.me/s/<channel>).
--
-- Not in `spots` because they expire; not named `events` because that name is
-- the analytics stream, which has no select policy and so would be unreadable
-- by the app. See packages/db/src/schema.ts for the full rationale.
--
-- Written only by the CLI (RLS-bypassing connection). The app reads published
-- rows; admins additionally read pending/rejected ones. No insert/update policy
-- exists on purpose — the review queue is a CLI command.

CREATE TABLE "happenings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_channel" text NOT NULL,
	"source_message_id" bigint NOT NULL,
	"source_url" text NOT NULL,
	"raw_text" text NOT NULL,
	"image_url" text,
	"posted_at" timestamp with time zone,
	"title" text,
	"summary" text,
	"venue_name" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"price_min" numeric,
	"price_max" numeric,
	"price_currency" text DEFAULT 'ETB' NOT NULL,
	"ticket_url" text,
	"is_event" boolean,
	"confidence" numeric,
	"extracted_at" timestamp with time zone,
	"spot_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"rejected_reason" text,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "happenings_status_check" CHECK ("happenings"."status" in ('pending','published','rejected')),
	CONSTRAINT "happenings_confidence_check" CHECK ("happenings"."confidence" between 0 and 1),
	CONSTRAINT "happenings_published_needs_start" CHECK ("happenings"."status" <> 'published' or "happenings"."starts_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "happenings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "happenings" ADD CONSTRAINT "happenings_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."spots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "happenings_source_idx" ON "happenings" USING btree ("source_channel","source_message_id");--> statement-breakpoint
CREATE INDEX "happenings_upcoming_idx" ON "happenings" USING btree ("starts_at") WHERE status = 'published';--> statement-breakpoint
CREATE INDEX "happenings_unextracted_idx" ON "happenings" USING btree ("extracted_at") WHERE extracted_at is null;--> statement-breakpoint
CREATE INDEX "happenings_status_idx" ON "happenings" USING btree ("status");--> statement-breakpoint
CREATE POLICY "public read happenings" ON "happenings" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ("happenings"."status" = 'published');--> statement-breakpoint
CREATE POLICY "admins read all happenings" ON "happenings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_admin());
