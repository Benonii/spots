CREATE TABLE "saved_spots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.uid())::text,
	"google_place_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_spots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_user_place_idx" ON "saved_spots" USING btree ("user_id","google_place_id");--> statement-breakpoint
CREATE POLICY "read own saved" ON "saved_spots" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid())::text = "saved_spots"."user_id");--> statement-breakpoint
CREATE POLICY "insert own saved" ON "saved_spots" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid())::text = "saved_spots"."user_id");--> statement-breakpoint
CREATE POLICY "delete own saved" ON "saved_spots" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid())::text = "saved_spots"."user_id");