import type { CommunityVisit, Spot } from "../lib/types";
import { VISIT_DIMS } from "../lib/types";
import { PRICE_LABELS } from "../lib/format";
import { StarMeter } from "./Stars";

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    return <img className="vt-avatar" src={url} alt={name} title={name} referrerPolicy="no-referrer" />;
  }
  return (
    <span className="vt-avatar vt-avatar-fallback" title={name} aria-label={name}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Read-only score bar — same look as the editable slider track, no interaction. */
function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const rated = value != null;
  const v = value ?? 0;
  return (
    <div className="vt-slider">
      <span className="vt-slider-label">{label}</span>
      <div className="rs-root rs-ro">
        <div className="rs-track">
          <div className="rs-range" style={{ width: `${(v / 5) * 100}%` }} />
        </div>
      </div>
      <span className={"vt-slider-val" + (rated ? "" : " empty")}>
        {rated ? v.toFixed(1) : "–"}
      </span>
    </div>
  );
}

/** Everyone's log — the same "Places we've been" table, read-only, with a Who column. */
export function CommunityTable({
  entries,
  spotsById,
}: {
  entries: CommunityVisit[];
  spotsById: Record<string, Spot>;
}) {
  if (!entries.length) {
    return (
      <div className="visited-empty">
        No reviews yet. Mark a place as been and leave a note — it shows up here for everyone.
      </div>
    );
  }
  return (
    <div className="visited-table is-community">
      <div className="vt-head">
        <span className="vt-c-place">Place</span>
        <span className="vt-c-area">Area</span>
        <span className="vt-c-price">Price</span>
        <span className="vt-c-rate">Rating</span>
        <span className="vt-c-date">Visited</span>
        <span className="vt-c-who">Who</span>
        <span className="vt-c-notes">Review</span>
      </div>
      {entries.map((e) => {
        const s = spotsById[e.placeId];
        const name = e.author?.displayName || "Someone";
        return (
          <div className="vt-entry" key={e.id}>
            <div className="vt-row">
              <span className="vt-c-place vt-place">{e.name}</span>
              <div className="vt-meta">
                <span className="vt-c-area">{s?.neighborhood ?? "—"}</span>
                <span className="vt-c-price">
                  {s && s.price_level != null ? PRICE_LABELS[s.price_level] : "—"}
                </span>
                <span className="vt-c-rate">
                  <StarMeter value={e.rating || 0} size={15} />
                </span>
                <span className="vt-c-date">{e.visitedAt}</span>
              </div>
              <span className="vt-c-who vt-who">
                <Avatar name={name} url={e.author?.avatarUrl ?? null} />
              </span>
              <span className="vt-c-notes vt-review">{e.notes || "—"}</span>
            </div>
            <div className="vt-sliders">
              {VISIT_DIMS.map(([key, label]) => (
                <ScoreBar key={key} label={label} value={e[key]} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
