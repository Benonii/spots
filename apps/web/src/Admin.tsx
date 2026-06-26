import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import type { Profile, Role, Spot } from "./lib/types";
import { signInWithGoogle, supabase } from "./lib/supabase";
import {
  fetchMyRole,
  fetchSpotsForAdmin,
  setSpotHidden,
  listAdmins,
  searchProfiles,
  setRole as setUserRole,
} from "./lib/curation";
import { PRICE_LABELS } from "./lib/format";
import { SpotEditor } from "./components/SpotEditor";
import { BrandMark } from "./components/BrandMark";

type Filter = "all" | "manual" | "scraped" | "hidden" | "mine";
type EditorState = { mode: "create" } | { mode: "edit"; spot: Spot } | null;

const param = (k: string) => {
  try {
    return new URLSearchParams(window.location.search).get(k);
  } catch {
    return null;
  }
};

export function Admin() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null); // null = still resolving
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editor, setEditor] = useState<EditorState>(null);
  const [busy, setBusy] = useState<string | null>(null); // spot id mid-hide
  const [toast, setToast] = useState<string | null>(null);

  // session + role
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setRole(null);
      return;
    }
    fetchMyRole(user.id).then(setRole);
  }, [user]);

  const isAdmin = role === "admin" || role === "super";

  const load = useCallback(() => {
    fetchSpotsForAdmin()
      .then(setSpots)
      .catch(() => setSpots([]));
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  // honor ?new=1 / ?edit=<placeId> once spots are in
  useEffect(() => {
    if (!isAdmin || !spots) return;
    if (param("new")) {
      setEditor({ mode: "create" });
      window.history.replaceState({}, "", "/admin");
    } else {
      const pid = param("edit");
      if (pid) {
        const s = spots.find((x) => x.google_place_id === pid);
        if (s) setEditor({ mode: "edit", spot: s });
        window.history.replaceState({}, "", "/admin");
      }
    }
  }, [isAdmin, spots]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const canManage = (s: Spot) => role === "super" || (!!user && s.owner_id === user.id);
  const canDelete = (s: Spot) => s.source === "manual" && canManage(s);

  const onSaved = () => {
    setEditor(null);
    flash("Saved.");
    load();
  };
  const onDeleted = () => {
    setEditor(null);
    flash("Spot deleted.");
    load();
  };

  const toggleHidden = async (s: Spot) => {
    setBusy(s.id);
    try {
      await setSpotHidden(s.id, !s.hidden);
      flash(s.hidden ? "Spot restored." : "Spot hidden.");
      load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't update.");
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => {
    const all = spots ?? [];
    return {
      all: all.length,
      manual: all.filter((s) => s.source === "manual").length,
      scraped: all.filter((s) => s.source !== "manual").length,
      hidden: all.filter((s) => s.hidden).length,
      mine: all.filter((s) => user && s.owner_id === user.id).length,
    };
  }, [spots, user]);

  const visible = useMemo(() => {
    let list = spots ?? [];
    if (filter === "manual") list = list.filter((s) => s.source === "manual");
    else if (filter === "scraped") list = list.filter((s) => s.source !== "manual");
    else if (filter === "hidden") list = list.filter((s) => s.hidden);
    else if (filter === "mine") list = list.filter((s) => user && s.owner_id === user.id);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.neighborhood ?? "").toLowerCase().includes(q) ||
          s.tags.some((t) => t.includes(q)),
      );
    }
    return list;
  }, [spots, filter, query, user]);

  /* ── gates ──────────────────────────────────────────────────────────── */
  if (user && role === null) {
    return <AdminShell><div className="adm-loading">Checking your access…</div></AdminShell>;
  }
  if (!user || !isAdmin) {
    return (
      <AdminShell>
        <div className="adm-locked">
          <h2>Curators only</h2>
          <p>This is where the team curates spots. You'll need an admin account.</p>
          {!user ? (
            <button className="adm-btn-primary" onClick={() => void signInWithGoogle()}>
              Sign in with Google
            </button>
          ) : (
            <Link to="/" className="adm-btn-ghost">Back to spots</Link>
          )}
        </div>
      </AdminShell>
    );
  }

  /* ── studio ─────────────────────────────────────────────────────────── */
  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: `All ${counts.all}` },
    { key: "mine", label: `Mine ${counts.mine}` },
    { key: "manual", label: `Curated ${counts.manual}` },
    { key: "scraped", label: `Scraped ${counts.scraped}` },
    { key: "hidden", label: `Hidden ${counts.hidden}` },
  ];

  return (
    <AdminShell role={role}>
      <div className="adm-toolbar">
        <div className="adm-search">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search spots…"
            aria-label="Search spots"
          />
        </div>
        <button className="adm-add" onClick={() => setEditor({ mode: "create" })}>
          <PlusIcon /> Add a spot
        </button>
      </div>

      <div className="adm-filters" role="tablist" aria-label="Filter spots">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            className={"adm-fchip" + (filter === f.key ? " on" : "")}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!spots ? (
        <div className="adm-loading">Loading spots…</div>
      ) : visible.length === 0 ? (
        <div className="adm-empty">
          <p>{query ? "Nothing matches that search." : "No spots here yet."}</p>
          {filter !== "all" && (
            <button className="adm-btn-ghost" onClick={() => setFilter("all")}>Show all</button>
          )}
        </div>
      ) : (
        <ul className="adm-list">
          {visible.map((s, i) => (
            <li
              key={s.id}
              className={"adm-row" + (s.hidden ? " is-hidden" : "")}
              style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
            >
              <span className="adm-thumb" aria-hidden="true">
                {s.cover_image_url ? <img src={s.cover_image_url} alt="" loading="lazy" /> : null}
              </span>
              <div className="adm-row-main">
                <span className="adm-row-name">
                  {s.name}
                  {s.source === "manual" && <span className="adm-tag adm-tag-manual">curated</span>}
                  {s.hidden && <span className="adm-tag adm-tag-hidden">hidden</span>}
                  {(s.locked_fields?.length ?? 0) > 0 && s.source !== "manual" && (
                    <span className="adm-tag adm-tag-edited" title={`Protected: ${s.locked_fields!.join(", ")}`}>
                      edited
                    </span>
                  )}
                </span>
                <span className="adm-row-meta">
                  {s.neighborhood ?? "Addis Ababa"}
                  {s.price_level != null ? ` · ${PRICE_LABELS[s.price_level]}` : ""}
                  {` · score ${Math.round(s.quality_score)}`}
                </span>
              </div>
              <div className="adm-row-actions">
                {canManage(s) ? (
                  <>
                    <button className="adm-mini" onClick={() => setEditor({ mode: "edit", spot: s })}>
                      Edit
                    </button>
                    <button
                      className="adm-mini"
                      disabled={busy === s.id}
                      onClick={() => toggleHidden(s)}
                    >
                      {s.hidden ? "Unhide" : "Hide"}
                    </button>
                  </>
                ) : (
                  <span className="adm-readonly" title="Owned by another admin">view only</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {role === "super" && <AdminsPanel flash={flash} meId={user.id} />}

      {editor && (
        <SpotEditor
          mode={editor.mode}
          spot={editor.mode === "edit" ? editor.spot : undefined}
          userId={user.id}
          canDelete={editor.mode === "edit" ? canDelete(editor.spot) : false}
          onClose={() => setEditor(null)}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      )}

      {toast && <div className="adm-toast" role="status">{toast}</div>}
    </AdminShell>
  );
}

/* ── shell ──────────────────────────────────────────────────────────────── */
function AdminShell({ children, role }: { children: React.ReactNode; role?: Role }) {
  return (
    <div className="adm">
      <header className="adm-head">
        <Link to="/" className="adm-back" aria-label="Back to spots">
          <BrandMark className="adm-mark" />
        </Link>
        <div className="adm-head-text">
          <h1>Curation studio</h1>
          <p>Add, edit and tidy the spots people discover.</p>
        </div>
        {role && <span className={"adm-role adm-role-" + role}>{role}</span>}
      </header>
      {children}
    </div>
  );
}

/* ── super: manage admins ───────────────────────────────────────────────── */
function AdminsPanel({ flash, meId }: { flash: (m: string) => void; meId: string }) {
  const [open, setOpen] = useState(false);
  const [admins, setAdmins] = useState<Profile[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Profile[]>([]);

  const refresh = useCallback(() => {
    listAdmins().then(setAdmins).catch(() => {});
  }, []);
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchProfiles(q).then((r) => setResults(r.filter((p) => p.role !== "super" && p.role !== "admin")));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const change = async (id: string, role: Role) => {
    try {
      await setUserRole(id, role);
      flash(role === "user" ? "Access revoked." : `Now ${role}.`);
      setQ("");
      setResults([]);
      refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't change role.");
    }
  };

  return (
    <section className={"adm-admins" + (open ? " open" : "")}>
      <button className="adm-admins-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>Team &amp; access</span>
        <ChevIcon open={open} />
      </button>
      <div className="adm-admins-body">
        <div className="adm-admins-inner">
          <ul className="adm-team">
            {admins.map((a) => (
              <li key={a.id} className="adm-team-row">
                <span className="adm-team-who">
                  {a.avatarUrl ? <img src={a.avatarUrl} alt="" /> : <span className="adm-av-fb">{(a.displayName ?? "?").charAt(0)}</span>}
                  <span>{a.displayName ?? "Someone"}{a.id === meId ? " (you)" : ""}</span>
                </span>
                <span className="adm-team-actions">
                  <span className={"adm-role adm-role-" + a.role}>{a.role}</span>
                  {a.id !== meId && (
                    <>
                      {a.role === "admin" ? (
                        <button className="adm-mini" onClick={() => change(a.id, "super")}>Make super</button>
                      ) : (
                        <button className="adm-mini" onClick={() => change(a.id, "admin")}>Make admin</button>
                      )}
                      <button className="adm-mini adm-mini-warn" onClick={() => change(a.id, "user")}>Revoke</button>
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
                    <button className="adm-mini" onClick={() => change(p.id, "admin")}>Make admin</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="adm-promote-hint">They must have signed in here at least once to appear.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── icons ──────────────────────────────────────────────────────────────── */
function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" /><path d="M13 13l-2.7-2.7" />
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
function ChevIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease" }}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
