import type { Spot, VisitedEntry } from "../lib/types";
import { PRICE_LABELS } from "../lib/format";
import { EditableStars } from "./Stars";

export function VisitedTable({
  visited,
  spotsById,
  onUpdate,
  onRemove,
}: {
  visited: VisitedEntry[];
  spotsById: Record<string, Spot>;
  onUpdate: (placeId: string, patch: Partial<VisitedEntry>) => void;
  onRemove: (placeId: string) => void;
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
          <div className="vt-row" key={v.placeId}>
            <span className="vt-c-place vt-place">{v.name}</span>
            <span className="vt-c-area">{s?.neighborhood ?? "—"}</span>
            <span className="vt-c-price">
              {s && s.price_level != null ? PRICE_LABELS[s.price_level] : "—"}
            </span>
            <span className="vt-c-rate">
              <EditableStars
                value={v.rating || 0}
                onChange={(r) => onUpdate(v.placeId, { rating: r })}
              />
            </span>
            <span className="vt-c-date">{v.visitedAt}</span>
            <span className="vt-c-notes">
              <textarea
                className="note-input"
                value={v.notes || ""}
                placeholder="Add a note…"
                rows={2}
                onChange={(e) => onUpdate(v.placeId, { notes: e.target.value })}
              />
            </span>
            <button
              className="vt-remove"
              onClick={() => onRemove(v.placeId)}
              aria-label="Remove"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
