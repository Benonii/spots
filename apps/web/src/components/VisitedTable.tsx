import { useRef } from "react";
import * as RSlider from "@radix-ui/react-slider";
import type { Spot, VisitedEntry, VisitPatch } from "../lib/types";
import { VISIT_DIMS } from "../lib/types";
import { PRICE_LABELS } from "../lib/format";
import { fireConfetti, fireImplosion } from "../lib/confetti";
import { EditableStars } from "./Stars";

/** Muted red → orange → green by score (0..5), low saturation to match the UI. */
function dimColor(v: number): string {
  const t = Math.max(0, Math.min(1, v / 5));
  // piecewise hue so the midpoint reads orange, not yellow
  const hue = t < 0.5 ? 8 + (t / 0.5) * (34 - 8) : 34 + ((t - 0.5) / 0.5) * (122 - 34);
  return `hsl(${hue}, 34%, 50%)`;
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  const thumbRef = useRef<HTMLSpanElement>(null);
  const rated = value != null;
  const v = value ?? 0;

  const handle = (n: number) => {
    if (n === 5 && v !== 5 && thumbRef.current) fireConfetti(thumbRef.current);
    if (n === 0 && v !== 0 && thumbRef.current) fireImplosion(thumbRef.current);
    onChange(n);
  };

  return (
    <label className="vt-slider">
      <span className="vt-slider-label">{label}</span>
      <RSlider.Root
        className="rs-root"
        min={0}
        max={5}
        step={0.5}
        value={[v]}
        onValueChange={([n]) => handle(n!)}
        aria-label={label}
      >
        <RSlider.Track className="rs-track">
          <RSlider.Range className="rs-range" />
        </RSlider.Track>
        <RSlider.Thumb ref={thumbRef} className="rs-thumb" />
      </RSlider.Root>
      <span
        className={"vt-slider-val" + (rated ? "" : " empty")}
        style={rated ? { color: dimColor(v) } : undefined}
      >
        {rated ? v.toFixed(1) : "–"}
      </span>
    </label>
  );
}

export function VisitedTable({
  visited,
  spotsById,
  onUpdate,
  onRemove,
}: {
  visited: VisitedEntry[];
  spotsById: Record<string, Spot>;
  onUpdate: (id: string, patch: VisitPatch) => void;
  onRemove: (id: string) => void;
}) {
  if (!visited.length) {
    return (
      <div className="visited-empty">
        No places marked yet. Mark a spot as “been” to start your log.
      </div>
    );
  }
  return (
    <div className="visited-table">
      <div className="vt-head">
        <span className="vt-c-place">Place</span>
        <span className="vt-c-area">Area</span>
        <span className="vt-c-price">Price</span>
        <span className="vt-c-rate">Our rating</span>
        <span className="vt-c-date">Visited</span>
        <span className="vt-c-notes">Our notes</span>
        <span className="vt-c-x" />
      </div>
      {visited.map((v) => {
        const s = spotsById[v.placeId];
        return (
          <div className="vt-entry" key={v.id}>
            <div className="vt-row">
              <span className="vt-c-place vt-place">{v.name}</span>
              <div className="vt-meta">
                <span className="vt-c-area">{s?.neighborhood ?? "—"}</span>
                <span className="vt-c-price">
                  {s && s.price_level != null ? PRICE_LABELS[s.price_level] : "—"}
                </span>
                <span className="vt-c-rate">
                  <EditableStars
                    value={v.rating || 0}
                    onChange={(r) => onUpdate(v.id, { rating: r })}
                  />
                </span>
                <span className="vt-c-date">{v.visitedAt}</span>
              </div>
              <span className="vt-c-notes">
                <textarea
                  className="note-input"
                  value={v.notes || ""}
                  placeholder="Add a note… (Enter to save, Shift+Enter for a new line)"
                  rows={2}
                  onChange={(e) => onUpdate(v.id, { notes: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.blur(); // commit (write-through already debounced)
                    }
                  }}
                />
              </span>
              <button
                className="vt-remove"
                onClick={() => onRemove(v.id)}
                aria-label="Remove"
              >
                ×
              </button>
            </div>
            <div className="vt-sliders">
              {VISIT_DIMS.map(([key, label]) => (
                <Slider
                  key={key}
                  label={label}
                  value={v[key]}
                  onChange={(n) => onUpdate(v.id, { [key]: n })}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
