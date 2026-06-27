import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FC,
  type FormEvent,
} from "react";
import type { Dimensions, Spot } from "../lib/types";
import {
  createSpot,
  deleteSpot,
  draftScore,
  setSpotHidden,
  updateSpot,
  type SpotDraft,
} from "../lib/curation";
import { priceLevel } from "@spots/db/scoring";
import { isShortMapsLink, parseMapsUrl } from "../lib/mapurl";

const DIMENSIONS: { key: keyof Dimensions; label: string }[] = [
  { key: "aesthetic", label: "Aesthetic" },
  { key: "vibe", label: "Vibe" },
  { key: "food", label: "Food" },
  { key: "value", label: "Value" },
  { key: "service", label: "Service" },
];

const PRICE_GLYPH = ["—", "$", "$$", "$$$", "$$$$"];

function blankDraft(): SpotDraft {
  return {
    name: "",
    description: "",
    mapUrl: "",
    lat: null,
    lng: null,
    neighborhood: "",
    address: "",
    tags: [],
    priceMin: null,
    priceMax: null,
    priceBasis: "per_person",
    dimensions: { aesthetic: 3, vibe: 3, food: 3, value: 3, service: 3 },
  };
}

function draftFromSpot(s: Spot): SpotDraft {
  // a scraped spot's quality_signals can be the empty `{}` default — fall back
  // to a neutral 0 per dimension so the sliders stay controlled.
  const d = s.quality_signals?.dimensions ?? ({} as Partial<Dimensions>);
  const dim = (k: keyof Dimensions) => d[k] ?? 0;
  return {
    name: s.name,
    description: s.summary ?? "",
    mapUrl: s.map_url ?? "",
    lat: s.lat,
    lng: s.lng,
    neighborhood: s.neighborhood ?? "",
    address: s.address ?? "",
    tags: [...s.tags],
    priceMin: s.price_min,
    priceMax: s.price_max,
    priceBasis: s.price_basis,
    dimensions: {
      aesthetic: dim("aesthetic"),
      vibe: dim("vibe"),
      food: dim("food"),
      value: dim("value"),
      service: dim("service"),
    },
  };
}

type Props = {
  mode: "create" | "edit";
  spot?: Spot;
  userId: string;
  canDelete: boolean;
  canHide: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
};

type Status = "idle" | "saving" | "error";

export function SpotEditor({ mode, spot, userId, canDelete, canHide, onClose, onSaved, onDeleted }: Props) {
  const [draft, setDraft] = useState<SpotDraft>(() =>
    mode === "edit" && spot ? draftFromSpot(spot) : blankDraft(),
  );
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(spot?.cover_image_url ?? null);
  const [tagDraft, setTagDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const set = <K extends keyof SpotDraft>(key: K, value: SpotDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // resolve coordinates from the pasted Maps link
  const mapState = useMemo(() => {
    const v = draft.mapUrl.trim();
    if (!v) return { kind: "empty" as const };
    const coords = parseMapsUrl(v);
    if (coords) return { kind: "ok" as const, coords };
    if (isShortMapsLink(v)) return { kind: "short" as const };
    return { kind: "bad" as const };
  }, [draft.mapUrl]);

  // keep lat/lng in sync with a freshly resolved link
  useEffect(() => {
    if (mapState.kind === "ok") {
      set("lat", mapState.coords.lat);
      set("lng", mapState.coords.lng);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapState.kind, mapState.kind === "ok" ? mapState.coords.lat : 0]);

  // entrance focus + escape + body scroll lock
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

  // revoke object URLs we created for the preview
  useEffect(() => {
    return () => {
      if (coverPreview?.startsWith("blob:")) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  const onPickCover = (file: File | null) => {
    if (!file) return;
    if (coverPreview?.startsWith("blob:")) URL.revokeObjectURL(coverPreview);
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const addTag = (raw: string) => {
    const t = raw.trim().toLowerCase().replace(/^#/, "");
    if (!t || draft.tags.includes(t)) return;
    set("tags", [...draft.tags, t]);
    setTagDraft("");
  };

  const score = draftScore(draft);
  const level = priceLevel(draft.priceMin, draft.priceMax, draft.priceBasis) ?? 0;

  // what's still missing for a valid create
  const missing = useMemo(() => {
    const m: string[] = [];
    if (!draft.name.trim()) m.push("name");
    if (!draft.description.trim()) m.push("description");
    if (mode === "create" && !coverFile) m.push("a cover image");
    if (draft.lat == null || draft.lng == null) m.push("a location");
    if (draft.priceMin == null && draft.priceMax == null) m.push("a price");
    if (!draft.tags.length) m.push("at least one tag");
    return m;
  }, [draft, coverFile, mode]);

  const canSave = missing.length === 0 && status !== "saving";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setStatus("saving");
    setErrorMsg(null);
    try {
      if (mode === "create") {
        await createSpot(userId, draft, coverFile!);
      } else if (spot) {
        await updateSpot(spot, userId, draft, coverFile);
      }
      onSaved();
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Couldn't save. Try again.");
    }
  };

  const onConfirmDelete = async () => {
    if (!spot) return;
    setStatus("saving");
    setErrorMsg(null);
    try {
      await deleteSpot(spot.id);
      onDeleted();
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Couldn't delete. Try again.");
    }
  };

  const onToggleHidden = async () => {
    if (!spot) return;
    setStatus("saving");
    setErrorMsg(null);
    try {
      await setSpotHidden(spot.id, !spot.hidden);
      onSaved();
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Couldn't update. Try again.");
    }
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
            <p className="ed-eyebrow">{mode === "create" ? "New spot" : "Editing"}</p>
            <h2 id={titleId}>{mode === "create" ? "Add a spot" : spot?.name}</h2>
          </div>
          <button className="ed-x" type="button" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </header>

        <form className="ed-form" onSubmit={onSubmit}>
          {/* cover */}
          <label className="ed-cover" data-has={coverPreview ? "1" : "0"}>
            {coverPreview ? (
              <img src={coverPreview} alt="" className="ed-cover-img" />
            ) : (
              <span className="ed-cover-empty">
                <ImageIcon />
                <span>Add a cover photo</span>
                <small>Tap to choose · landscape looks best</small>
              </span>
            )}
            <input
              type="file"
              accept="image/*"
              className="ed-file"
              onChange={(e) => onPickCover(e.target.files?.[0] ?? null)}
            />
            {coverPreview && <span className="ed-cover-edit">Change photo</span>}
          </label>

          <Field label="Name">
            <input
              className="ed-input"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Tomoca Coffee, Piassa"
              maxLength={120}
            />
          </Field>

          <Field label="Description" hint="A sentence on why it's a good date spot.">
            <textarea
              className="ed-textarea"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Roastery-cafe with standing tables and the best macchiato in Addis…"
              rows={3}
              maxLength={600}
            />
          </Field>

          <Field
            label="Google Maps link"
            hint="Open the place in Google Maps, Share → copy the link, paste it here."
          >
            <input
              className="ed-input"
              value={draft.mapUrl}
              onChange={(e) => set("mapUrl", e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
              inputMode="url"
            />
            <MapStatus state={mapState} />
          </Field>

          <div className="ed-grid2">
            <Field label="Neighborhood" hint="Optional">
              <input
                className="ed-input"
                value={draft.neighborhood}
                onChange={(e) => set("neighborhood", e.target.value)}
                placeholder="Bole"
                maxLength={60}
              />
            </Field>
            <Field label="Address" hint="Optional">
              <input
                className="ed-input"
                value={draft.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Africa Ave"
                maxLength={140}
              />
            </Field>
          </div>

          {/* tags */}
          <Field label="Tags" hint="Press Enter to add. Think rooftop, quiet, coffee.">
            <div className="ed-tags">
              {draft.tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="ed-tag"
                  onClick={() => set("tags", draft.tags.filter((x) => x !== t))}
                  aria-label={`Remove ${t}`}
                >
                  {t} <span aria-hidden="true">×</span>
                </button>
              ))}
              <input
                className="ed-tag-input"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagDraft);
                  } else if (e.key === "Backspace" && !tagDraft && draft.tags.length) {
                    set("tags", draft.tags.slice(0, -1));
                  }
                }}
                onBlur={() => addTag(tagDraft)}
                placeholder={draft.tags.length ? "" : "rooftop, quiet…"}
              />
            </div>
          </Field>

          {/* price */}
          <Field label="Price range" hint="Birr per person, roughly.">
            <div className="ed-price">
              <input
                className="ed-input ed-num"
                type="number"
                min={0}
                value={draft.priceMin ?? ""}
                onChange={(e) => set("priceMin", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="min"
              />
              <span className="ed-price-dash">–</span>
              <input
                className="ed-input ed-num"
                type="number"
                min={0}
                value={draft.priceMax ?? ""}
                onChange={(e) => set("priceMax", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="max"
              />
              <div className="ed-basis" role="group" aria-label="Price basis">
                {(["per_person", "total"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    className={"ed-basis-opt" + (draft.priceBasis === b ? " on" : "")}
                    onClick={() => set("priceBasis", b)}
                  >
                    {b === "per_person" ? "per person" : "total"}
                  </button>
                ))}
              </div>
              <span className="ed-price-level" aria-label={`Price level ${level} of 4`}>
                {PRICE_GLYPH[level]}
              </span>
            </div>
          </Field>

          {/* dimensions + live score */}
          <div className="ed-rating">
            <div className="ed-rating-head">
              <span className="ed-label">How good is it?</span>
              <span className="ed-score" aria-live="polite">
                <strong>{score}</strong>
                <small>/ 100</small>
              </span>
            </div>
            <div className="ed-dims">
              {DIMENSIONS.map(({ key, label }) => (
                <label key={key} className="ed-dim">
                  <span className="ed-dim-label">{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.5}
                    value={draft.dimensions[key]}
                    onChange={(e) =>
                      set("dimensions", { ...draft.dimensions, [key]: Number(e.target.value) })
                    }
                    className="ed-slider"
                  />
                  <span className="ed-dim-val">{draft.dimensions[key].toFixed(1)}</span>
                </label>
              ))}
            </div>
          </div>

          {errorMsg && (
            <p className="ed-error" role="alert">
              {errorMsg}
            </p>
          )}
          {!canSave && missing.length > 0 && (
            <p className="ed-missing">Still needs {missing.join(", ")}.</p>
          )}

          <div className="ed-actions">
            {mode === "edit" && confirmDelete ? (
              <span className="ed-del-confirm">
                Delete for good?
                <button type="button" className="ed-del-yes" onClick={onConfirmDelete}>
                  Yes, delete
                </button>
                <button type="button" className="ed-del-no" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </span>
            ) : mode === "edit" && (canHide || canDelete) ? (
              <span className="ed-left-actions">
                {canHide && (
                  <button type="button" className="ed-delete" onClick={onToggleHidden}>
                    {spot?.hidden ? "Unhide" : "Hide"}
                  </button>
                )}
                {canDelete && (
                  <button type="button" className="ed-delete" onClick={() => setConfirmDelete(true)}>
                    Delete
                  </button>
                )}
              </span>
            ) : (
              <span />
            )}
            <div className="ed-actions-right">
              <button type="button" className="ed-cancel" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="ed-save" disabled={!canSave}>
                {status === "saving"
                  ? "Saving…"
                  : mode === "create"
                    ? "Publish spot"
                    : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── small pieces ───────────────────────────────────────────────────────── */

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

function MapStatus({
  state,
}: {
  state:
    | { kind: "empty" }
    | { kind: "ok"; coords: { lat: number; lng: number } }
    | { kind: "short" }
    | { kind: "bad" };
}) {
  if (state.kind === "empty") return null;
  if (state.kind === "ok") {
    return (
      <span className="ed-map-ok">
        <PinIcon /> Found · {state.coords.lat.toFixed(4)}, {state.coords.lng.toFixed(4)}
      </span>
    );
  }
  if (state.kind === "short") {
    return (
      <span className="ed-map-warn">
        That's a short link — open it, then copy the full URL from the address bar.
      </span>
    );
  }
  return <span className="ed-map-warn">Couldn't find coordinates in that link.</span>;
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.8" />
      <path d="M21 16l-5-5L5 20" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </svg>
  );
}
