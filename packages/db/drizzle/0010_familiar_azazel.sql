CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"props" jsonb,
	"user_id" text DEFAULT (auth.uid())::text,
	"anon_id" text,
	"path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_name_idx" ON "events" USING btree ("name");--> statement-breakpoint
CREATE INDEX "events_actor_idx" ON "events" USING btree ("user_id","anon_id");--> statement-breakpoint
CREATE POLICY "anyone insert events" ON "events" AS PERMISSIVE FOR INSERT TO "anon", "authenticated" WITH CHECK ("events"."user_id" is null or (select auth.uid())::text = "events"."user_id");