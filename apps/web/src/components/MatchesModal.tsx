import { useEffect, useId, useRef, useState } from "react";
import type { ContactType, Match, OptIn } from "../lib/dating";

/**
 * The opt-in + matches surface. Reuses the editor sheet chrome
 * (.ed-scrim/.ed-panel). Not opted in → the opt-in form; opted in → your
 * confirmed matches (with the peer's revealed contact) plus settings. Contact
 * only ever reaches here for a mutual match (server-enforced in my_matches()).
 */

const CHANNELS: { key: ContactType; label: string; placeholder: string }[] = [
  { key: "telegram", label: "Telegram", placeholder: "@username" },
  { key: "instagram", label: "Instagram", placeholder: "@username" },
  { key: "email", label: "Email", placeholder: "you@example.com" },
];

const firstName = (n: string | null) => (n?.trim().split(/\s+/)[0] ?? "Someone") || "Someone";

/** Deep link to the peer on their chosen channel. The scheme+host are fixed
 * literals so a hostile contact_value can't change where the link points;
 * encoding keeps odd handles (spaces, ?, /) from mangling the path. */
function contactHref(type: ContactType, value: string): string {
  const handle = encodeURIComponent(value.trim().replace(/^@/, ""));
  if (type === "telegram") return `https://t.me/${handle}`;
  if (type === "instagram") return `https://instagram.com/${handle}`;
  return `mailto:${value.trim()}`;
}

function MatchRow({ m }: { m: Match }) {
  return (
    <li className="mt-match">
      {m.avatarUrl ? (
        <img className="vt-avatar" src={m.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="vt-avatar vt-avatar-fallback">{firstName(m.displayName).charAt(0)}</span>
      )}
      <div className="mt-match-main">
        <span className="mt-match-name">{firstName(m.displayName)}</span>
        <span className="mt-match-sub">
          {m.overlapCount} shared {m.overlapCount === 1 ? "place" : "places"}
        </span>
      </div>
      <a className="mt-contact" href={contactHref(m.contactType, m.contactValue)} target="_blank" rel="noreferrer">
        {m.contactType === "email" ? m.contactValue : "@" + m.contactValue.replace(/^@/, "")}
      </a>
    </li>
  );
}

export function MatchesModal({
  optIn,
  matches,
  onClose,
  onSave,
  onLeave,
}: {
  optIn: OptIn | null;
  matches: Match[];
  onClose: () => void;
  onSave: (o: OptIn) => Promise<void>;
  onLeave: () => Promise<void>;
}) {
  const titleId = useId();
  const restore = useRef<HTMLElement | null>(null);

  // editing when not yet opted in, or when the user chooses to change contact
  const [editing, setEditing] = useState(optIn == null);
  const [type, setType] = useState<ContactType>(optIn?.contactType ?? "telegram");
  const [value, setValue] = useState(optIn?.contactValue ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The modal can open before the opt-in fetch resolves (header button is live
  // as soon as the session is). When optIn lands after mount, resync — otherwise
  // an already-opted-in user sees a blank telegram form and saving it would
  // silently overwrite their real contact channel.
  useEffect(() => {
    if (optIn) {
      setEditing(false);
      setType(optIn.contactType);
      setValue(optIn.contactValue);
    }
  }, [optIn]);

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

  const submit = async () => {
    if (!value.trim()) {
      setNote("Add your contact so a match can reach you.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await onSave({ contactType: type, contactValue: value.trim(), active: optIn?.active ?? true });
      setEditing(false);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!optIn) return;
    setBusy(true);
    try {
      await onSave({ ...optIn, active: !optIn.active });
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't update.");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    try {
      await onLeave();
      onClose();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't opt out.");
      setBusy(false);
    }
  };

  const placeholder = CHANNELS.find((c) => c.key === type)?.placeholder;

  return (
    <div className="ed-scrim" onClick={onClose}>
      <div
        className="ed-panel mt-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ed-head">
          <div>
            <p className="ed-eyebrow">
              Find the perfect <s>spot</s> person
            </p>
            <h2 id={titleId}>Matches</h2>
          </div>
          <button className="ed-x" type="button" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="ed-form">
          {/* the !optIn arm also guards a late fetchOptIn resolving to null
              after a save — never render the status view without a row */}
          {editing || !optIn ? (
            <div className="mt-optin">
              <p className="mt-lede">
                Match with people who want to go to the same spots. You'll only see
                each other's contact when you've <em>both</em> liked — nothing before that.
              </p>
              <div className="mt-seg" role="group" aria-label="Contact channel">
                {CHANNELS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={"mt-seg-btn" + (type === c.key ? " on" : "")}
                    onClick={() => setType(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <input
                className="ed-input mt-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                inputMode={type === "email" ? "email" : "text"}
                aria-label="Your contact"
              />
              <p className="mt-fineprint">
                Only people you both like ever see this. Blocking someone hides you from
                them for good, and you can opt out anytime.
              </p>
              <div className="mt-actions">
                <button className="mt-primary" onClick={submit} disabled={busy}>
                  {optIn ? "Save" : "Opt in"}
                </button>
                {optIn && (
                  <button className="mt-ghost" onClick={() => setEditing(false)} disabled={busy}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="mt-status">
                <label className="mt-switch">
                  <input type="checkbox" checked={optIn.active} onChange={toggleActive} disabled={busy} />
                  <span>{optIn.active ? "Discoverable" : "Hidden — not matching"}</span>
                </label>
                <button className="mt-linkbtn" onClick={() => setEditing(true)}>
                  {optIn.contactType} · {optIn.contactValue} — edit
                </button>
              </div>

              {matches.length === 0 ? (
                <div className="mt-empty">
                  <p>No matches yet.</p>
                  <p className="mt-empty-sub">
                    Save spots you want to go to, then like people who share them. When
                    they like you back, they'll show up here.
                  </p>
                </div>
              ) : (
                <ul className="mt-matches">
                  {matches.map((m) => (
                    <MatchRow key={m.userId} m={m} />
                  ))}
                </ul>
              )}

              <button className="mt-leave" onClick={leave} disabled={busy}>
                Opt out &amp; remove my data
              </button>
            </>
          )}

          {note && <p className="ed-missing" role="status">{note}</p>}
        </div>
      </div>
    </div>
  );
}
