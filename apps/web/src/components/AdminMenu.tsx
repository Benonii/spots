import { useEffect, useRef, useState } from "react";

/**
 * Single topbar admin control → a popover menu (Add a spot / Review drafts /
 * Team & access). Replaces the row of separate admin buttons so the topbar stays
 * compact on mobile. Closes on outside click, Escape, or choosing an item.
 */
export function AdminMenu({
  isSuper,
  draftCount,
  showDrafts,
  onAddSpot,
  onToggleDrafts,
  onOpenTeam,
}: {
  isSuper: boolean;
  draftCount: number;
  showDrafts: boolean;
  onAddSpot: () => void;
  onToggleDrafts: () => void;
  onOpenTeam: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const hasDrafts = draftCount > 0 || showDrafts;

  return (
    <div className={"admin-menu" + (open ? " open" : "")} ref={wrapRef}>
      <button
        type="button"
        className="curate-link admin-menu-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Admin menu"
      >
        <ShieldIcon />
        <span className="curate-link-label">Admin</span>
      </button>

      <div className="admin-pop" role="menu" aria-label="Admin">
        <button type="button" className="admin-item" role="menuitem" onClick={run(onAddSpot)}>
          <PlusIcon /> Add a spot
        </button>
        {hasDrafts && (
          <button type="button" className="admin-item" role="menuitem" onClick={run(onToggleDrafts)}>
            <DraftIcon />
            {showDrafts ? "Show published" : "Review drafts"}
            {!showDrafts && draftCount > 0 && <span className="admin-item-count">{draftCount}</span>}
          </button>
        )}
        {isSuper && (
          <button type="button" className="admin-item" role="menuitem" onClick={run(onOpenTeam)}>
            <TeamIcon /> Team &amp; access
          </button>
        )}
      </div>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 2.6v5.2c0 4.4-3 7.6-7 9.2-4-1.6-7-4.8-7-9.2V5.6L12 3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
function DraftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M9.5 13h5M9.5 16.5h5" />
    </svg>
  );
}
function TeamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" />
    </svg>
  );
}
