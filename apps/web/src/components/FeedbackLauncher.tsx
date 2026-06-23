import { useEffect, useRef, useState } from "react";
import { FeedbackModal } from "./FeedbackModal";

/**
 * Floating launcher for feedback + "What's New", pinned bottom-right.
 *
 * - Large screens: a dedicated "Feedback" button bottom-right. The separate
 *   "What's New" button (WhatsNewButton) keeps its top-right spot.
 * - Small screens: a single round FAB that opens a popup menu with both
 *   "What's New" (triggers the Shiplog widget via [data-shiplog-open]) and
 *   "Give feedback". The standalone buttons are hidden via CSS at this width.
 *
 * Which control shows is driven entirely by CSS media queries; both are always
 * rendered so there's no layout flash on resize.
 */
function FeedbackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16v11H9l-4 3v-3H4z" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4z" />
      <path d="M18.5 14.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function FeedbackLauncher() {
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // close the mobile popup on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const openFeedback = () => {
    setMenuOpen(false);
    setModalOpen(true);
  };

  return (
    <>
      {/* large screens — dedicated bottom-right feedback button */}
      <button
        type="button"
        className="feedback-btn"
        onClick={() => setModalOpen(true)}
        title="Send feedback"
      >
        <FeedbackIcon />
        <span className="feedback-btn-label">Feedback</span>
      </button>

      {/* small screens — one FAB → popup menu */}
      <div className={"fab-wrap" + (menuOpen ? " open" : "")} ref={wrapRef}>
        <div className="fab-menu" role="menu" aria-label="More">
          <button
            type="button"
            className="fab-item"
            role="menuitem"
            data-shiplog-open
            onClick={() => setMenuOpen(false)}
          >
            <SparkIcon />
            What's New
          </button>
          <button type="button" className="fab-item" role="menuitem" onClick={openFeedback}>
            <FeedbackIcon />
            Give feedback
          </button>
        </div>
        <button
          type="button"
          className="fab"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close menu" : "What's New and feedback"}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <CloseIcon /> : <FeedbackIcon />}
        </button>
      </div>

      <FeedbackModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
