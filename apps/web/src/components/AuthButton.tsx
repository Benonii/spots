import { useEffect, useId, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Tooltip } from "./Tooltip";

/** Google's multicolor "G" mark. */
function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  );
}

/* Flame + head from "Match" by Tamada (Noun Project, #7611259); attribution
 * kept here since the SVG's credit text isn't rendered. The artwork's tilted
 * stem subpaths are dropped (its walls clipped away via HOLE_D) and a vertical
 * stem is drawn in the same linework style — the user wanted the stick
 * straight but the flame exactly as drawn. */
const MATCH_D =
  "m77.141 28.578c-0.24219-0.41406-0.71484-0.62891-1.1914-0.52734-0.46875 0.10156-0.82031 0.48828-0.87109 0.96484-0.32031 2.9414-2.0156 4.6562-3.4961 5.2773-1.1484 0.48438-2.2969 0.41406-3.0664-0.19141-1.1758-0.92187-1.7891-1.8984-1.8203-2.9062-0.054687-1.6914 1.4766-3.3203 2.3906-4.1445 1.7734-1.5859 3.0898-3.5352 3.8125-5.6406 2.3633-6.8945-3.1992-10.852-6.4727-11.977-0.5-0.17188-1.0547 0.03125-1.3203 0.48828s-0.17578 1.0391 0.22266 1.3906c0.023437 0.019531 2.1992 2.0195 0.027344 6.0586-0.64062 1.1914-1.2734 1.4531-2.4219 1.9258-1.2188 0.50391-2.8906 1.1914-4.9688 3.3203-2.4453 2.5117-2.4141 6.3711-2.3867 9.4766 0.011719 1.5898 0.03125 3.5664-0.45312 3.9805-0.13672 0.11719-0.46094 0.085937-0.64453 0.054687-1-0.16016-1.3477-0.60547-1.5234-0.92188-0.74219-1.3594 0.10938-3.9961 0.46484-4.8086 0.21094-0.48047 0.058594-1.0469-0.37109-1.3516-0.42969-0.30469-1.0117-0.26953-1.3984 0.089844-7.2422 6.7109-7.3242 14.328-7.3242 14.648 0 4.1406 1.5156 8.0312 4.2891 11.07l-30.102 30.102c-0.43359 0.43359-0.43359 1.1367 0 1.5703l3.7617 3.7617c0.20703 0.20703 0.49219 0.32422 0.78516 0.32422s0.57812-0.11719 0.78516-0.32422l31.059-31.059c1.957 0.80078 4.0273 1.2539 6.168 1.3398 0.44922 0.019532 0.91797 0.027344 1.4062 0.027344 6.8984 0 17.246-2.1016 19.156-14.289 1.2266-7.8164-4.2578-17.344-4.4922-17.742zM79.442 45.976c-1.6875 10.777-10.867 12.68-18.277 12.383-1.5625-0.0625-3.082-0.34375-4.5352-0.84375l3.6523-3.6523c0.41406 0.1875 0.85547 0.28906 1.3008 0.28906 0.80859 0 1.6211-0.30859 2.2383-0.92578l3.7422-3.7422c0.98438-0.98438 1.5273-2.293 1.5273-3.6875s-0.54297-2.7031-1.5273-3.6875l-0.86328-0.86328c-0.98438-0.98438-2.293-1.5273-3.6875-1.5273s-2.7031 0.54297-3.6875 1.5273l-3.7422 3.7422c-0.59766 0.59766-0.92578 1.3906-0.92578 2.2383 0 0.45703 0.10547 0.89844 0.28906 1.3047l-4.7578 4.7578c-2.3516-2.6211-3.6367-5.957-3.6367-9.5 0-0.058593 0.078125-4.9023 3.8867-10.004 0.003906 0.85547 0.15234 1.7227 0.56641 2.4805 0.42188 0.77734 1.3047 1.7617 3.1211 2.0547 1 0.16406 1.8203-0.027343 2.4453-0.5625 1.2695-1.0898 1.25-3.2188 1.2305-5.6836-0.023437-2.8359-0.050781-6.0508 1.7578-7.9062 1.7539-1.8008 3.0664-2.3398 4.2227-2.8164 1.293-0.53125 2.5156-1.0352 3.5312-2.9258 1.1641-2.1641 1.3672-3.9492 1.1758-5.3359 1.8047 1.4102 3.6016 3.8438 2.3125 7.5977-0.59766 1.7461-1.7031 3.375-3.1914 4.707-1.4727 1.3164-3.2109 3.4062-3.1289 5.8711 0.054687 1.6914 0.95312 3.2344 2.6719 4.582 1.4102 1.1094 3.3945 1.293 5.2969 0.48828 1.7812-0.75 3.2109-2.2383 4.0547-4.1328 1.5 3.2305 3.6914 8.9883 2.9414 13.77z";
const HOLE_D = "M0 0H100V100H0Z M52.8 46.8 L61.2 55.2 L19.2 97.2 L10.8 88.8 Z";
const FLAME_CLIP_D = "M34 36 L52 2 L94 2 L94 66 L58 66 L44 50 Z";

/** The "Matches" pun, literally: a vertical match, unlit until the user opts
 * in, then the flame + head turn orange. Flame flicker on hover is a CSS
 * micro-interaction; the stick itself never moves. */
function MatchstickIcon({ lit }: { lit: boolean }) {
  const id = useId();
  return (
    <svg
      className={"match-icon" + (lit ? " lit" : "")}
      viewBox="37 4 48 80"
      width="24"
      height="24"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={`${id}h`}>
          <path clipRule="evenodd" d={HOLE_D} />
        </clipPath>
        <clipPath id={`${id}f`}>
          <path d={FLAME_CLIP_D} />
        </clipPath>
      </defs>
      <g className="match-base">
        <path d={MATCH_D} clipPath={`url(#${id}h)`} />
        <rect x="57.6" y="60" width="6.4" height="19.5" rx="2.4" fill="none" strokeWidth="5.1" />
      </g>
      <g className="match-flame" clipPath={`url(#${id}f)`}>
        <path d={MATCH_D} clipPath={`url(#${id}h)`} />
      </g>
    </svg>
  );
}

/** Door-with-arrow sign-out, sized to sit flush with the matchstick's column. */
function SignOutIcon() {
  return (
    <svg
      className="signout-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.5 5H8.2a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6.3" />
      {/* arrow slides right on row hover (see .so-arrow) */}
      <g className="so-arrow">
        <path d="M14.8 8.4 18.4 12l-3.6 3.6" />
        <path d="M18.4 12h-8" />
      </g>
    </svg>
  );
}

/** Header auth control: "Sign in with Google" when signed out; avatar menu
 * (Matches + Sign out) when in. */
export function AuthButton({
  user,
  onSignIn,
  onSignOut,
  onOpenMatches,
  unreadMatches = 0,
  optedIn = false,
}: {
  user: User | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenMatches: () => void;
  unreadMatches?: number;
  optedIn?: boolean;
}) {
  if (!user) {
    return (
      <Tooltip label="Sign in">
        <button className="auth-btn" onClick={onSignIn} aria-label="Sign in with Google">
          <GoogleG />
          <span className="auth-btn-label">Sign in</span>
        </button>
      </Tooltip>
    );
  }

  return (
    <AuthMenu
      user={user}
      onSignOut={onSignOut}
      onOpenMatches={onOpenMatches}
      unreadMatches={unreadMatches}
      optedIn={optedIn}
    />
  );
}

/** Signed-in control: avatar (+ name on wider screens) → account menu with
 * Matches and Sign out. An orange dot on the avatar mirrors unread matches so
 * the signal survives the move into the menu. */
function AuthMenu({
  user,
  onSignOut,
  onOpenMatches,
  unreadMatches,
  optedIn,
}: {
  user: User;
  onSignOut: () => void;
  onOpenMatches: () => void;
  unreadMatches: number;
  optedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const meta = user.user_metadata ?? {};
  const name =
    (meta.full_name as string) || (meta.name as string) || user.email || "Account";
  const avatar = (meta.avatar_url as string) || (meta.picture as string) || "";

  /** Close and hand focus back to the trigger, so keyboard users aren't dropped
   * to <body> when the menu unmounts. */
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    // move focus into the menu on open (ARIA menu contract)
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      // roving focus between the menu items
      e.preventDefault();
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? i + 1 : i - 1;
      items[(next + items.length) % items.length]?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={"auth-user" + (open ? " open" : "")} ref={wrapRef}>
      <button
        type="button"
        className="auth-trigger"
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={
          unreadMatches === 0
            ? "Account"
            : unreadMatches === 1
              ? "Account, 1 new match"
              : `Account, ${unreadMatches} new matches`
        }
      >
        <span className="auth-avatar-wrap">
          {avatar ? (
            <img className="auth-avatar" src={avatar} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="auth-avatar auth-avatar-fallback">{name.charAt(0).toUpperCase()}</span>
          )}
          {unreadMatches > 0 && <span className="auth-dot" aria-hidden="true" />}
        </span>
        <span className="auth-name">{name}</span>
      </button>

      <div className="auth-pop" id={menuId} ref={menuRef} role="menu" aria-label="Account">
        <span className="auth-pop-name">{name}</span>
        <button
          type="button"
          className="admin-item"
          role="menuitem"
          onClick={() => {
            // focus the trigger first so the modal, which captures the active
            // element on mount, restores focus here on close
            close();
            onOpenMatches();
          }}
        >
          <MatchstickIcon lit={optedIn} />
          Matches
          <span className="tag-new tag-beta">Beta</span>
          {unreadMatches > 0 && <span className="admin-item-count">{unreadMatches}</span>}
        </button>
        <button
          type="button"
          className="admin-item"
          role="menuitem"
          onClick={() => {
            close();
            onSignOut();
          }}
        >
          <SignOutIcon />
          Sign out
        </button>
      </div>
    </div>
  );
}
