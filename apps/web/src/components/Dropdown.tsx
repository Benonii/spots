import { useEffect, useRef, useState } from "react";

export type Option = { value: string; label: string };

export function Dropdown({
  value,
  options,
  onChange,
  align = "left",
}: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sel = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className={"dd" + (open ? " open" : "")} ref={ref}>
      <button
        type="button"
        className="dd-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dd-value">{sel ? sel.label : ""}</span>
        <span className="dd-caret" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              d="M2 4l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open && (
        <div className={"dd-menu dd-" + align} role="listbox">
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={"dd-opt" + (o.value === value ? " sel" : "")}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="dd-opt-label">{o.label}</span>
              <span className="dd-check">{o.value === value ? "✓" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
