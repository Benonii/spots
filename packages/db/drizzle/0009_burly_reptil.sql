CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'general' NOT NULL,
	"message" text NOT NULL,
	"email" text,
	"user_id" text DEFAULT (auth.uid())::text,
	"page_url" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_kind_check" CHECK ("feedback"."kind" in ('bug','feature','general')),
	CONSTRAINT "feedback_message_len_check" CHECK (char_length("feedback"."message") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "feedback_created_idx" ON "feedback" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "anyone insert feedback" ON "feedback" AS PERMISSIVE FOR INSERT TO "anon", "authenticated" WITH CHECK ("feedback"."user_id" is null or (select auth.uid())::text = "feedback"."user_id");