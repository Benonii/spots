import { useRef, useState } from "react";
import diceSoundUrl from "../assets/dice-roll.mp3";

// Pip layouts per face, on a 0..100 viewBox.
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[32, 32], [68, 68]],
  3: [[32, 32], [50, 50], [68, 68]],
  4: [[32, 32], [68, 32], [32, 68], [68, 68]],
  5: [[32, 32], [68, 32], [50, 50], [32, 68], [68, 68]],
  6: [[32, 30], [68, 30], [32, 50], [68, 50], [32, 70], [68, 70]],
};

/** "Surprise me" button: the die tumbles to a new face (with a roll sound) on click. */
export function DiceButton({
  onClick,
  label = "Surprise me",
}: {
  onClick: () => void;
  label?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [face, setFace] = useState(5);
  const [rolling, setRolling] = useState(false);

  const roll = () => {
    setFace(1 + Math.floor(Math.random() * 6));
    setRolling(true);

    const audio = (audioRef.current ??= new Audio(diceSoundUrl));
    audio.volume = 0.4;
    audio.currentTime = 0;
    void audio.play().catch(() => {}); // ignore autoplay rejections

    onClick();
  };

  return (
    <button className="surprise" onClick={roll}>
      <svg
        className={"dice-svg" + (rolling ? " rolling" : "")}
        onAnimationEnd={() => setRolling(false)}
        viewBox="0 0 100 100"
        width="17"
        height="17"
        aria-hidden="true"
      >
        <rect x="6" y="6" width="88" height="88" rx="24" fill="currentColor" />
        {PIPS[face]!.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="9.5" fill="var(--accent)" />
        ))}
      </svg>
      {label}
    </button>
  );
}
