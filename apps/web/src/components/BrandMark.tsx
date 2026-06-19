/** App logo: a location pin holding a golden-hour Addis sunset (place + the warm date vibe). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Where to next"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="bm-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbe6c9" />
          <stop offset="1" stopColor="#f6cf95" />
        </linearGradient>
        <radialGradient id="bm-sun" cx="50%" cy="45%" r="55%">
          <stop offset="0" stopColor="#ffd76a" />
          <stop offset="100%" stopColor="#ef9a3d" />
        </radialGradient>
        <clipPath id="bm-head">
          <circle cx="24" cy="19" r="12.6" />
        </clipPath>
      </defs>
      <path
        d="M24 3.4 C15 3.4 7.4 10.5 7.4 19.2 C7.4 28.6 17.6 38.6 22.7 44.4 a1.75 1.75 0 0 0 2.6 0 C30.4 38.6 40.6 28.6 40.6 19.2 C40.6 10.5 33 3.4 24 3.4 Z"
        fill="#2c4232"
      />
      <g clipPath="url(#bm-head)">
        <rect x="11" y="6" width="26" height="27" fill="url(#bm-sky)" />
        <circle cx="24" cy="21.5" r="6.6" fill="url(#bm-sun)" />
        <path d="M11 24.5 q 6 -4.6 12 -1 q 7 3.8 14 -1 v 12 h -26 Z" fill="#6e8f6a" />
        <path d="M11 27.5 q 7 -3 13 0.8 q 6 3 13 -1 v 9 h -26 Z" fill="#3e5c44" />
      </g>
      <circle cx="24" cy="19" r="12.6" fill="none" stroke="#2c4232" strokeWidth="2.2" />
    </svg>
  );
}
