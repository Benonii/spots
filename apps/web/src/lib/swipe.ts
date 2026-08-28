import { useRef, useState, type CSSProperties, type TouchEvent, type MouseEvent } from "react";

/**
 * Tinder-style horizontal swipe for a deck of cards, shared by the spots and
 * events decks so both feel identical under the thumb.
 *
 * Drag horizontally to move between cards; vertical drags are handed back to
 * the page so scrolling still works. Past the threshold the card flings out,
 * the deck advances, and the incoming card slides in from the opposite edge.
 */
const SWIPE_MS = 200;

export type SwipeDeck = {
  /** Spread onto the card element. */
  cardProps: {
    style: CSSProperties | undefined;
    onTouchStart: (event: TouchEvent) => void;
    onTouchMove: (event: TouchEvent) => void;
    onTouchEnd: () => void;
    onTransitionEnd: () => void;
    onClickCapture: (event: MouseEvent) => void;
  };
  /** True once the reader has swiped at least once this session. */
  swiped: boolean;
};

export function useSwipeDeck({
  onPrev,
  onNext,
  ignoreSelector,
  onFirstSwipe,
}: {
  onPrev: () => void;
  onNext: () => void;
  /** Descendants matching this keep their own touch handling (e.g. a map). */
  ignoreSelector?: string;
  onFirstSwipe?: () => void;
}): SwipeDeck {
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [swiped, setSwiped] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"none" | "h" | "v">("none");
  const dragged = useRef(false);

  const onTouchStart = (event: TouchEvent) => {
    if (ignoreSelector && (event.target as HTMLElement).closest(ignoreSelector)) {
      start.current = null;
      return;
    }
    const touch = event.touches[0]!;
    start.current = { x: touch.clientX, y: touch.clientY };
    axis.current = "none";
    dragged.current = false;
    setAnimating(false);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!start.current) return;
    const touch = event.touches[0]!;
    const moveX = touch.clientX - start.current.x;
    const moveY = touch.clientY - start.current.y;
    if (axis.current === "none") {
      if (Math.abs(moveX) < 8 && Math.abs(moveY) < 8) return;
      // lock to one axis on the first meaningful movement; vertical = page scroll
      axis.current = Math.abs(moveX) > Math.abs(moveY) ? "h" : "v";
    }
    if (axis.current !== "h") return;
    dragged.current = true;
    setDx(moveX);
  };

  const onTouchEnd = () => {
    if (!start.current || axis.current !== "h") {
      start.current = null;
      return;
    }
    start.current = null;
    const threshold = Math.min(56, window.innerWidth * 0.14);
    const width = window.innerWidth;
    if (Math.abs(dx) <= threshold) {
      setAnimating(true);
      setDx(0); // didn't pass the threshold → spring back
      return;
    }
    const forward = dx < 0; // swipe left → next, swipe right → previous
    if (!swiped) {
      setSwiped(true);
      onFirstSwipe?.();
    }
    setAnimating(true);
    setDx(forward ? -width : width); // fling out
    window.setTimeout(() => {
      if (forward) onNext();
      else onPrev();
      setAnimating(false);
      setDx(forward ? width : -width); // new card waits off the opposite edge
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setAnimating(true);
          setDx(0); // ...and slides in
        }),
      );
    }, SWIPE_MS);
  };

  const moving = animating || dx !== 0;
  return {
    swiped,
    cardProps: {
      style: moving
        ? {
            transform: `translateX(${dx}px) rotate(${dx * 0.03}deg)`,
            transition: animating ? `transform ${SWIPE_MS}ms ease` : "none",
          }
        : undefined,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTransitionEnd: () => {
        if (dx === 0) setAnimating(false);
      },
      onClickCapture: (event: MouseEvent) => {
        // a swipe just happened — swallow the trailing click so links don't fire
        if (dragged.current) {
          event.preventDefault();
          event.stopPropagation();
          dragged.current = false;
        }
      },
    },
  };
}
