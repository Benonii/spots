import { useEffect, useId, useRef, useState, type FC, type FormEvent } from "react";
import type { HappeningReview } from "../lib/types";
import { reviewHappening, type HappeningDraft, type HappeningVerdict } from "../lib/curation";
import { EVENT_KINDS } from "../lib/happenings";

/**
 * Review one pending event: fix what the extraction got wrong, then publish or
 * reject it. Built on the SpotEditor's panel and field styles so the two admin
 * surfaces feel like one tool.
 *
 * The original post sits under the form rather than in a tooltip: the whole
 * point of review is checking the extraction against its source, and the
 * details the model most often misses (a time, a price) are in the post text.
 */

// The closed tag vocabulary is defined by the CLI's extraction schema; the
// app's filter chips already carry every value, so derive from those rather
// than import across packages.
const TAGS = [...new Set(EVENT_KINDS.flatMap((kind) => kind.tags))];

const ADDIS_OFFSET_MS = 3 * 3600e3;

/** ISO instant → the date and clock a reader in Addis would write down. */
function toAddis(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const local = new Date(Date.parse(iso) + ADDIS_OFFSET_MS).toISOString();
  const time = local.slice(11, 16);
  // Midnight is the extraction's "no time given" — see timeLabel().
  return { date: local.slice(0, 10), time: time === "00:00" ? "" : time };
}

/** Addis date + optional clock → ISO instant; null when no date. */
function fromAddis(date: string, time: string): string | null {
  if (!date) return null;
  return new Date(`${date}T${time || "00:00"}:00+03:00`).toISOString();
}

type Form = Omit<HappeningDraft, "starts_at" | "ends_at"> & {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

function formFrom(h: HappeningReview): Form {
  const start = toAddis(h.starts_at);
  const end = toAddis(h.ends_at);
  return {
    title: h.title ?? "",
    summary: h.summary ?? "",
    venue_name: h.venue_name ?? "",
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    price_min: h.price_min,
    price_max: h.price_max,
    ticket_url: h.ticket_url ?? "",
    tags: [...h.tags],
  };
}

function draftFrom(f: Form): HappeningDraft {
  return {
    title: f.title,
    summary: f.summary,
    venue_name: f.venue_name,
    starts_at: fromAddis(f.startDate, f.startTime),
    ends_at: fromAddis(f.endDate, f.endTime),
    price_min: f.price_min,
    price_max: f.price_max,
    ticket_url: f.ticket_url,
    tags: f.tags,
  };
}

export function EventEditor({
  happening,
  userId,
  onClose,
  onDecided,
}: {
  happening: HappeningReview;
  userId: string;
  onClose: () => void;
  /** Called after any successful write; `verdict` says whether the row left the queue. */
  onDecided: (verdict: HappeningVerdict) => void;
}) {
  const [form, setForm] = useState<Form>(() => formFrom(happening));
  const [busy, setBusy] = useState<HappeningVerdict | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // entrance focus + escape + body scroll lock — same contract as SpotEditor
  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    }, 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      restoreFocus.current?.focus?.();
    };
  }, [onClose]);

  const published = happening.status === "published";
  const missing: string[] = [];
  if (!form.title.trim()) missing.push("a title");
  if (!form.startDate) missing.push("a start date");
  if (!form.tags.length) missing.push("a tag");
  const canPublish = missing.length === 0 && !busy;

  const decide = async (verdict: HappeningVerdict) => {
    if (busy) return;
    setBusy(verdict);
    setErrorMsg(null);
    try {
      await reviewHappening(happening.id, userId, draftFrom(form), verdict);
      onDecided(verdict);
    } catch (err) {
      setBusy(null);
      setErrorMsg(err instanceof Error ? err.message : "Couldn't save. Try again.");
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canPublish) void decide("published");
  };

  return (
    <div className="ed-scrim" onClick={onClose}>
      <div
        className="ed-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ed-head">
          <div>
            <p className="ed-eyebrow">{published ? "Editing" : "Review event"}</p>
            <h2 id={titleId}>{happening.title ?? "Untitled event"}</h2>
          </div>
          <button className="ed-x" type="button" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </header>

        <form className="ed-form" onSubmit={onSubmit}>
          <Field label="Title">
            <input
              className="ed-input"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Saq Jam — 4th Anniversary"
              maxLength={120}
            />
          </Field>

          <Field label="Venue">
            <input
              className="ed-input"
              value={form.venue_name}
              onChange={(e) => set("venue_name", e.target.value)}
              placeholder="Anki Liquor, Bole"
              maxLength={120}
            />
          </Field>

          <Field label="Starts" hint="Addis time. Leave the clock empty if the post doesn't say.">
            <div className="ed-price">
              <input
                className="ed-input"
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
              <input
                className="ed-input ed-num"
                type="time"
                value={form.startTime}
                onChange={(e) => set("startTime", e.target.value)}
              />
            </div>
          </Field>

          <Field label="Ends" hint="Only for multi-day events — it stays listed until then.">
            <div className="ed-price">
              <input
                className="ed-input"
                type="date"
                value={form.endDate}
                min={form.startDate || undefined}
                onChange={(e) => set("endDate", e.target.value)}
              />
              <input
                className="ed-input ed-num"
                type="time"
                value={form.endTime}
                onChange={(e) => set("endTime", e.target.value)}
              />
            </div>
          </Field>

          <Field label="Price (ETB)" hint="Empty means the post names no price.">
            <div className="ed-price">
              <input
                className="ed-input ed-num"
                type="number"
                min={0}
                value={form.price_min ?? ""}
                onChange={(e) => set("price_min", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="min"
              />
              <span className="ed-price-dash">–</span>
              <input
                className="ed-input ed-num"
                type="number"
                min={0}
                value={form.price_max ?? ""}
                onChange={(e) => set("price_max", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="max"
              />
            </div>
          </Field>

          <Field label="Ticket link">
            <input
              className="ed-input"
              value={form.ticket_url}
              onChange={(e) => set("ticket_url", e.target.value)}
              placeholder="https://…"
              inputMode="url"
            />
          </Field>

          {/* a div, not Field: a <label> would forward clicks to the first chip */}
          <div className="ed-field">
            <span className="ed-label">
              Tags
              <span className="ed-hint">Fixed list — the filter chips are built from it.</span>
            </span>
            <div className="ed-basis ed-tagset" role="group" aria-label="Tags">
              {TAGS.map((tag) => {
                const on = form.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={"ed-basis-opt" + (on ? " on" : "")}
                    aria-pressed={on}
                    onClick={() =>
                      set("tags", on ? form.tags.filter((t) => t !== tag) : [...form.tags, tag])
                    }
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          <Field label="Summary">
            <textarea
              className="ed-textarea"
              value={form.summary}
              onChange={(e) => set("summary", e.target.value)}
              rows={4}
              maxLength={500}
            />
          </Field>

          <section className="ed-source" aria-label="Original post">
            <span className="ed-label">
              Original post
              <span className="ed-hint">
                {happening.confidence != null && `model confidence ${Math.round(happening.confidence * 100)}%`}
              </span>
            </span>
            <pre className="ed-source-text">{happening.raw_text}</pre>
            <a className="ed-source-link" href={happening.source_url} target="_blank" rel="noreferrer">
              Open on Telegram
            </a>
          </section>

          {errorMsg && (
            <p className="ed-error" role="alert">
              {errorMsg}
            </p>
          )}
          {missing.length > 0 && (
            <p className="ed-missing">
              To {published ? "save" : "publish"}, add {missing.join(", ")}.
            </p>
          )}

          {/* A published row: Save keeps it live, Unpublish sends it back to the
              queue. A pending row: Publish, Save for later, or Reject. */}
          <div className="ed-actions">
            <span className="ed-left-actions">
              <button type="button" className="ed-delete" disabled={!!busy} onClick={() => void decide("rejected")}>
                {busy === "rejected" ? "Rejecting…" : "Reject"}
              </button>
              {published && (
                <button type="button" className="ed-delete" disabled={!!busy} onClick={() => void decide("pending")}>
                  {busy === "pending" ? "Unpublishing…" : "Unpublish"}
                </button>
              )}
            </span>
            <div className="ed-actions-right">
              {published ? (
                <button type="button" className="ed-cancel" disabled={!!busy} onClick={onClose}>
                  Cancel
                </button>
              ) : (
                <button type="button" className="ed-cancel" disabled={!!busy} onClick={() => void decide("pending")}>
                  {busy === "pending" ? "Saving…" : "Save for later"}
                </button>
              )}
              <button type="submit" className="ed-save" disabled={!canPublish}>
                {busy === "published" ? "Saving…" : published ? "Save changes" : "Publish"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const Field: FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <label className="ed-field">
    <span className="ed-label">
      {label}
      {hint && <span className="ed-hint">{hint}</span>}
    </span>
    {children}
  </label>
);

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
