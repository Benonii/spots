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
