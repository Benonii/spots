/**
 * LLM extraction contract (Zod) — the exact object `generateObject` must return,
 * one call per video. Verbatim from docs/schemas.md §5. Maps onto spots +
 * quality_signals; the CLI does the deterministic scoring (see scoring.ts).
 */
import { z } from "zod";
import type { Extraction } from "@spots/db";

export const extractionSchema = z.object({
  venueName: z.string().nullable(), // null if no identifiable place named
  neighborhood: z.string().nullable(),

  price: z.object({
    min: z.number().nullable(),
    max: z.number().nullable(), // null unless a range was stated
    // No .default(): OpenAI strict structured output requires every property in
    // `required`, and a Zod default makes the field optional. The prompt tells
    // the model to use ETB, so it always fills this.
    currency: z.string(),
    basis: z.enum(["per_person", "total", "unknown"]),
  }),

  tags: z.array(z.string()), // e.g. ['rooftop','coffee']
  summary: z.string(), // one-line blurb

  dimensions: z.object({
    aesthetic: z.number().min(0).max(5),
    vibe: z.number().min(0).max(5),
    food: z.number().min(0).max(5),
    value: z.number().min(0).max(5),
    service: z.number().min(0).max(5),
  }),

  evidence: z.object({
    positiveMentions: z.number().int(),
    negativeMentions: z.number().int(),
    aestheticMentions: z.number().int(),
  }),
});

export type ExtractionParsed = z.infer<typeof extractionSchema>;

// Compile-time guard: the Zod shape and the DB column type must stay aligned.
const _typeCheck: Extraction extends ExtractionParsed
  ? ExtractionParsed extends Extraction
    ? true
    : never
  : never = true;
void _typeCheck;
