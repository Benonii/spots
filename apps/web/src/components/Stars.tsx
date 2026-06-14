import { useState } from "react";

export function StarMeter({ value, max = 5, size = 20 }: { value: number; max?: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const row = (fill: string) => (
    <span style={{ color: fill, fontSize: size, lineHeight: 1, letterSpacing: size * 0.08 }}>
      ★★★★★
    </span>
  );
  return (
    <span className="starmeter" style={{ height: size }}>
      <span className="starmeter-bg">{row("var(--star-empty)")}</span>
      <span className="starmeter-fg" style={{ width: pct + "%" }}>
        {row("var(--star-fill)")}
      </span>
    </span>
  );
}

export function EditableStars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <span className="edit-stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className="edit-star"
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? 0 : n)}
          aria-label={n + " star"}
          style={{ color: (hover || value) >= n ? "var(--star-fill)" : "var(--star-empty)" }}
        >
          ★
        </button>
      ))}
    </span>
  );
}
