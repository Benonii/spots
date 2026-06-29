import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Profile, Role } from "../lib/types";
import { listAdmins, searchProfiles, setRole as setUserRole } from "../lib/curation";

/**
 * Super-admin "Team & access" — granted/revoked in place (no page). Reuses the
 * editor sheet chrome (.ed-scrim/.ed-panel). Grants go through the super-gated
 * set_role() RPC; people must have signed in once to be findable.
 */
export function TeamSheet({ meId, onClose }: { meId: string; onClose: () => void }) {
  const [admins, setAdmins] = useState<Profile[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  const refresh = useCallback(() => {
    listAdmins().then(setAdmins).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

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

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchProfiles(q)
        .then((r) => setResults(r.filter((p) => p.role !== "admin" && p.role !== "super")))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const change = async (id: string, role: Role) => {
    try {
      await setUserRole(id, role);
      setNote(role === "user" ? "Access revoked." : `Now ${role}.`);
      setQ("");
      setResults([]);
      refresh();
      setTimeout(() => setNote(null), 2200);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't change role.");
    }
  };

  return (
    <div className="ed-scrim" onClick={onClose}>
      <div
        className="ed-panel ed-panel-team"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ed-head">
          <div>
            <p className="ed-eyebrow">Super admin</p>
            <h2 id={titleId}>Team &amp; access</h2>
          </div>
          <button className="ed-x" type="button" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="ed-form">
          <ul className="adm-team">
            {admins.map((a) => (
              <li key={a.id} className="adm-team-row">
                <span className="adm-team-who">
                  {a.avatarUrl ? (
                    <img src={a.avatarUrl} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="adm-av-fb">{(a.displayName ?? "?").charAt(0)}</span>
                  )}
                  <span>
                    {a.displayName ?? "Someone"}
                    {a.id === meId ? " (you)" : ""}
                  </span>
                </span>
                <span className="adm-team-actions">
                  <span className={"adm-role adm-role-" + a.role}>{a.role}</span>
                  {a.id !== meId && (
                    <>
                      {a.role === "admin" ? (
                        <button className="adm-mini" onClick={() => change(a.id, "super")}>
                          Make super
                        </button>
                      ) : (
                        <button className="adm-mini" onClick={() => change(a.id, "admin")}>
                          Make admin
                        </button>
                      )}
                      <button className="adm-mini adm-mini-warn" onClick={() => change(a.id, "user")}>
                        Revoke
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <div className="adm-promote">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find someone by name to make admin…"
              aria-label="Search people"
            />
            {results.length > 0 && (
              <ul className="adm-results">
                {results.map((p) => (
                  <li key={p.id}>
                    <span>{p.displayName ?? "Someone"}</span>
                    <button className="adm-mini" onClick={() => change(p.id, "admin")}>
                      Make admin
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="adm-promote-hint">They must have signed in here at least once to appear.</p>
          </div>

          {note && <p className="ed-missing" role="status">{note}</p>}
        </div>
      </div>
    </div>
  );
}
