ALTER TABLE "visits" ALTER COLUMN "user_id" SET DEFAULT (auth.uid())::text;--> statement-breakpoint
ALTER POLICY "public read spots" ON "spots" TO anon,authenticated USING (true);--> statement-breakpoint
ALTER POLICY "public read visits" ON "visits" TO authenticated USING ((select auth.uid())::text = "visits"."user_id");--> statement-breakpoint
ALTER POLICY "anon insert visits" ON "visits" TO authenticated WITH CHECK ((select auth.uid())::text = "visits"."user_id");--> statement-breakpoint
ALTER POLICY "anon update visits" ON "visits" TO authenticated USING ((select auth.uid())::text = "visits"."user_id") WITH CHECK ((select auth.uid())::text = "visits"."user_id");--> statement-breakpoint
ALTER POLICY "anon delete visits" ON "visits" TO authenticated USING ((select auth.uid())::text = "visits"."user_id");