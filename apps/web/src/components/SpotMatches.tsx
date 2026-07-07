import { useEffect, useId, useRef, useState } from "react";
import { block, like, matchesForSpot, unlike, type SpotMatch } from "../lib/dating";

/**
 * "Who else wants to go here" — rendered under a saved spot. Shows other opted-in
 * users who also saved this place, ranked by want-to-go overlap, each with a Like
 * button. A like is the only verb; when it's mutual the pair appears in Matches
 * (server-side). Blocking hides the pair from each other everywhere. When the
 * viewer hasn't opted in, we show a one-line invitation instead of a list — the
 * RPC returns nothing to non-opted callers anyway.
 *
 * Inline the strip stays small (3 people); "+N more" opens the full list in the
 * shared sheet chrome (.ed-scrim/.ed-panel) so a popular spot never crowds the
 * card.
 */

const firstName = (n: string | null) => (n?.trim().split(/\s+/)[0] ?? "Someone") || "Someone";
const CAP = 3; // most people we list inline before "+N more"
// dismissing the opt-in invite is permanent on this browser — the header
// matches icon remains the way in for anyone who changes their mind
const INVITE_KEY = "spots:matchInviteDismissed";

export function SpotMatches({
  placeId,
  spotName,
  optedIn,
  onNeedOptIn,
  onLiked,
}: {
  placeId: string;
  spotName: string;
  optedIn: boolean;
  onNeedOptIn: () => void;
  onLiked: () => void;
}) {
  const [people, setPeople] = useState<SpotMatch[] | null>(null);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);
  const [inviteHidden, setInviteHidden] = useState(() => {
    try {
      return localStorage.getItem(INVITE_KEY) === "1";
    } catch {
      return false;
    }
  });
  // one request per person at a time (double-click would race INSERT vs DELETE),
  // and rollbacks must not touch state rebuilt for a different spot
  const pending = useRef<Set<string>>(new Set());
  const pidRef = useRef(placeId);
  pidRef.current = placeId;

  useEffect(() => {
    if (!optedIn) {
      setPeople(null);
      return;
    }
    let live = true;
    setPeople(null);
    setAllOpen(false);
    matchesForSpot(placeId)
      .then((rows) => {
        if (!live) return;
        setPeople(rows);
        setLiked(new Set(rows.filter((r) => r.liked).map((r) => r.userId)));
        setBlocked(new Set());
      })
      .catch((e) => {
        console.warn("spot matches unavailable:", e);
        if (live) setPeople([]);
      });
    return () => {
      live = false;
    };
  }, [placeId, optedIn]);

  if (!optedIn) {
    if (inviteHidden) return null;
    return (
      <div className="sm-invite">
        <button className="sm-invite-cta" onClick={onNeedOptIn}>
          <SparkIcon /> Meet people who want to go here too
        </button>
        <button
          className="sm-invite-x"
          aria-label="Dismiss"
          onClick={() => {
            setInviteHidden(true);
            try {
              localStorage.setItem(INVITE_KEY, "1");
            } catch {
              /* ignore */
            }
          }}
        >
          ×
        </button>
      </div>
    );
  }

  const visible = (people ?? []).filter((p) => !blocked.has(p.userId));
  if (!people || visible.length === 0) return null;

  const toggleLike = async (p: SpotMatch) => {
    if (pending.current.has(p.userId)) return;
    pending.current.add(p.userId);
    const pid = placeId;
    const on = liked.has(p.userId);
    setLiked((s) => {
      const n = new Set(s);
      on ? n.delete(p.userId) : n.add(p.userId);
      return n;
    });
    try {
      on ? await unlike(p.userId) : await like(p.userId);
      if (!on) onLiked(); // a reciprocal like may have just become a match
    } catch {
      // roll back only if we're still on the same spot — after a swipe the
      // liked set has been rebuilt from the new spot's rows
      if (pidRef.current === pid)
        setLiked((s) => {
          const n = new Set(s);
          on ? n.add(p.userId) : n.delete(p.userId);
          return n;
        });
    } finally {
      pending.current.delete(p.userId);
    }
  };

  const hide = async (p: SpotMatch) => {
    if (pending.current.has(p.userId)) return;
    pending.current.add(p.userId);
    const pid = placeId;
    setBlocked((s) => new Set(s).add(p.userId));
    try {
      await block(p.userId);
    } catch {
      if (pidRef.current === pid)
        setBlocked((s) => {
          const n = new Set(s);
          n.delete(p.userId);
          return n;
        });
    } finally {
      pending.current.delete(p.userId);
    }
  };

  const row = (p: SpotMatch) => (
    <li className="sm-row" key={p.userId}>
      {p.avatarUrl ? (
        <img className="vt-avatar" src={p.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="vt-avatar vt-avatar-fallback">{firstName(p.displayName).charAt(0)}</span>
      )}
      <div className="sm-who">
        <span className="sm-name">{firstName(p.displayName)}</span>
        {p.overlapCount > 1 && <span className="sm-sub">{p.overlapCount} shared places</span>}
      </div>
      <button
        className={"sm-like" + (liked.has(p.userId) ? " on" : "")}
        onClick={() => toggleLike(p)}
        aria-pressed={liked.has(p.userId)}
      >
        <HeartIcon filled={liked.has(p.userId)} />
        {liked.has(p.userId) ? "Liked" : "Like"}
      </button>
      <button className="sm-hide" onClick={() => hide(p)} aria-label={`Hide ${firstName(p.displayName)}`}>
        Hide
      </button>
    </li>
  );

  return (
    <div className="sm-wrap">
      <div className="sm-head">
        {visible.length} {visible.length === 1 ? "person wants" : "people want"} to go here too
      </div>
      <ul className="sm-list">{visible.slice(0, CAP).map(row)}</ul>
      {visible.length > CAP && (
        <button className="sm-more" onClick={() => setAllOpen(true)}>
          +{visible.length - CAP} more
        </button>
      )}
      {allOpen && (
        <PeopleSheet spotName={spotName} count={visible.length} onClose={() => setAllOpen(false)}>
          <ul className="sm-list sm-list-sheet">{visible.map(row)}</ul>
        </PeopleSheet>
      )}
    </div>
  );
}

/** Full list in the shared sheet chrome — same rows, no card crowding. */
function PeopleSheet({
  spotName,
  count,
  onClose,
  children,
}: {
  spotName: string;
  count: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restore.current = document.activeElement as HTMLElement | null;
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
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      restore.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="ed-scrim" onClick={onClose}>
      <div
        className="ed-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ed-head">
          <div>
            <p className="ed-eyebrow">
              {count} {count === 1 ? "person wants" : "people want"} to go here too
            </p>
            <h2 id={titleId}>{spotName}</h2>
          </div>
          <button className="ed-x" type="button" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="ed-form">{children}</div>
      </div>
    </div>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill={filled ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20s-7-4.7-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5C19 15.3 12 20 12 20z" />
    </svg>
  );
}
