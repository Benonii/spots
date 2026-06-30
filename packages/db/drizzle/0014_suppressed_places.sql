-- Permanent, super-only spot deletion. A scraped spot can't simply be deleted —
-- the next `spots upsert` re-creates it from its source_videos. So we record the
-- place id here (the upsert skips it) AND delete the row, atomically, via a
-- super-gated SECURITY DEFINER function.
CREATE TABLE IF NOT EXISTS "suppressed_places" (
  "google_place_id" text PRIMARY KEY NOT NULL,
  "reason" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppressed_places" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- No policy => only the definer function below and the RLS-bypassing CLI touch it.
CREATE OR REPLACE FUNCTION purge_spot(place_id text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin can permanently delete spots';
  END IF;
  INSERT INTO public.suppressed_places (google_place_id, created_by)
  VALUES (place_id, (SELECT auth.uid())::text)
  ON CONFLICT (google_place_id) DO NOTHING;
  DELETE FROM public.spots WHERE google_place_id = place_id;
END;
$$;
