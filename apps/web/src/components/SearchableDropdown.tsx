import { useEffect, useMemo, useRef, useState } from "react";

export type SearchOption = {
  value: string;
  label: string;
  /** Lowercase text the query is matched against — label plus any synonyms. */
  search?: string;
};

/**
 * A Dropdown that filters as you type.
 *
 * The area list runs to ~59 entries, which is past the point where scrolling a
 * menu beats typing three letters. Closed it is the same control as Dropdown —
 * same trigger, same spacing — so the filter row doesn't gain a second visual
 * language for what is still just a select.
 *
 * Matching is per-word against `search`, so "bole bul" finds Bole Bulbula and
 * "piazza" finds Piassa (the alias table supplies the synonyms).
 */
export function SearchableDropdown({
  value,
  options,
  onChange,
  placeholder = "Search…",
  ariaLabel,
}: {
  value: string;
  options: SearchOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options
      .filter((o) => {
        const hay = o.search ?? o.label.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      // A label that starts with the query is what you meant; a synonym buried
      // mid-string is a fallback. Sorting keeps Enter honest.
      .sort((a, b) => {
        const rank = (o: SearchOption) => (o.label.toLowerCase().startsWith(words[0]!) ? 0 : 1);
        return rank(a) - rank(b);
      });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Reopening should start clean, not on the last search.
  useEffect(() => {
    if (!open) setQuery("");
    setActive(0);
  }, [open, query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (matches.length ? (i + step + matches.length) % matches.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = matches[active];
      if (hit) pick(hit.value);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const selected = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className={"dd" + (open ? " open" : "")} ref={ref}>
      <button
        type="button"
        className="dd-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${selected ? selected.label : ""}` : undefined}
      >
        <span className="dd-value">{selected ? selected.label : ""}</span>
        <span className="dd-caret" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="dd-menu dd-search-menu" onKeyDown={onKeyDown}>
          <div className="dd-search">
            <svg className="dd-search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="dd-search-input"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              role="combobox"
              aria-expanded
              aria-controls="dd-search-list"
              aria-autocomplete="list"
              aria-label={ariaLabel}
            />
          </div>

          <div className="dd-search-list" id="dd-search-list" role="listbox" ref={listRef}>
            {matches.map((o, i) => (
              <button
                type="button"
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                data-active={i === active}
                className={"dd-opt" + (o.value === value ? " sel" : "") + (i === active ? " active" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
              >
                <span className="dd-opt-label">{o.label}</span>
                <span className="dd-check">{o.value === value ? "✓" : ""}</span>
              </button>
            ))}
            {!matches.length && <p className="dd-empty">No area called “{query.trim()}”</p>}
          </div>
        </div>
      )}
    </div>
  );
}
