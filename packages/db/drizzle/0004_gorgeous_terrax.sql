CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_place_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"visited_at" text NOT NULL,
	"rating" numeric,
	"notes" text,
	"aesthetic" numeric,
	"vibe" numeric,
	"food" numeric,
	"portions" numeric,
	"service" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "visits_place_idx" ON "visits" USING btree ("google_place_id");--> statement-breakpoint
CREATE INDEX "visits_user_idx" ON "visits" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "public read visits" ON "visits" AS PERMISSIVE FOR SELECT TO "anon" USING (true);--> statement-breakpoint
CREATE POLICY "anon insert visits" ON "visits" AS PERMISSIVE FOR INSERT TO "anon" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "anon update visits" ON "visits" AS PERMISSIVE FOR UPDATE TO "anon" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "anon delete visits" ON "visits" AS PERMISSIVE FOR DELETE TO "anon" USING (true);