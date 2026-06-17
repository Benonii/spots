import confetti from "canvas-confetti";

// Muted, low-saturation palette to match the app (red → orange → greens + cream).
const COLORS = ["#b5685c", "#d39a5a", "#6e8f6a", "#3e5c44", "#e8dcc2"];

/** A small celebratory burst centered on `el` (used when a slider hits 5). */
export function fireConfetti(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  confetti({
    particleCount: 26,
    spread: 55,
    startVelocity: 26,
    gravity: 0.9,
    scalar: 0.7,
    ticks: 90,
    origin: {
      x: (r.left + r.width / 2) / window.innerWidth,
      y: (r.top + r.height / 2) / window.innerHeight,
    },
    colors: COLORS,
    disableForReducedMotion: true,
  });
}

// Muted, cool/grey palette for the "deflate" — reads as the opposite of the warm burst.
const IMPLODE_COLORS = ["#8a8f98", "#a9a395", "#6e7d8f", "#b5685c", "#cbc3b2"];

/** The opposite of confetti: particles collapse inward and fade (used when a slider hits 0). */
export function fireImplosion(el: HTMLElement): void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "9999",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const N = 18;
  const parts = Array.from({ length: N }, (_, i) => ({
    angle: (i / N) * Math.PI * 2 + Math.random() * 0.5,
    dist: 30 + Math.random() * 26,
    size: 2 + Math.random() * 2.4,
    color: IMPLODE_COLORS[i % IMPLODE_COLORS.length]!,
  }));

  const DURATION = 520;
  const startedAt = performance.now();

  const frame = (now: number) => {
    const t = Math.min(1, (now - startedAt) / DURATION);
    const pull = t * t; // accelerate as they rush inward
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of parts) {
      const d = p.dist * (1 - pull);
      const x = cx + Math.cos(p.angle) * d;
      const y = cy + Math.sin(p.angle) * d;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.1, p.size * (1 - pull * 0.7)), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    if (t < 1) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
