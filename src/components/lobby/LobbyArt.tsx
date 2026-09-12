// Flat illustrations for the lobby, drawn in the same style as the game tile
// art in public/games.

type ArtProps = { className?: string };

export function ChipIcon({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="#f59e0b" />
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="#fde68a" strokeWidth="2.4" strokeDasharray="3 3.75" />
      <circle cx="12" cy="12" r="5.4" fill="#fbbf24" stroke="#b45309" strokeWidth="1" />
    </svg>
  );
}

const WHEEL_SEGMENTS = [
  ["M70 70 L70 14 A56 56 0 0 1 109.6 30.4 Z", "#7c3aed"],
  ["M70 70 L109.6 30.4 A56 56 0 0 1 126 70 Z", "#f472b6"],
  ["M70 70 L126 70 A56 56 0 0 1 109.6 109.6 Z", "#fbbf24"],
  ["M70 70 L109.6 109.6 A56 56 0 0 1 70 126 Z", "#22d3ee"],
  ["M70 70 L70 126 A56 56 0 0 1 30.4 109.6 Z", "#7c3aed"],
  ["M70 70 L30.4 109.6 A56 56 0 0 1 14 70 Z", "#f472b6"],
  ["M70 70 L14 70 A56 56 0 0 1 30.4 30.4 Z", "#fbbf24"],
  ["M70 70 L30.4 30.4 A56 56 0 0 1 70 14 Z", "#22d3ee"],
] as const;

const WHEEL_BULBS = [
  [93.4, 13.6], [126.4, 46.6], [126.4, 93.4], [93.4, 126.4],
  [46.6, 126.4], [13.6, 93.4], [13.6, 46.6], [46.6, 13.6],
] as const;

export function WheelArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 140 140" className={className} aria-hidden>
      <circle cx="70" cy="70" r="66" fill="#2e1065" stroke="#fbbf24" strokeWidth="4" />
      {WHEEL_SEGMENTS.map(([d, fill]) => (
        <path key={d} d={d} fill={fill} />
      ))}
      {WHEEL_BULBS.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.6" fill="#fef3c7" />
      ))}
      <circle cx="70" cy="70" r="12" fill="#fbbf24" />
      <circle cx="70" cy="70" r="5" fill="#fef3c7" />
      <path d="M61 1 h18 l-9 17 z" fill="#fef3c7" stroke="#b45309" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function GiftArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 140 140" className={className} aria-hidden>
      <ellipse cx="70" cy="128" rx="46" ry="6" fill="#000" opacity="0.3" />
      <rect x="26" y="62" width="88" height="64" rx="8" fill="#10b981" />
      <path d="M70 62 H106 a8 8 0 0 1 8 8 V118 a8 8 0 0 1 -8 8 H70 Z" fill="#059669" />
      <rect x="20" y="46" width="100" height="22" rx="6" fill="#34d399" />
      <path d="M70 46 H114 a6 6 0 0 1 6 6 V62 a6 6 0 0 1 -6 6 H70 Z" fill="#10b981" />
      <rect x="62" y="46" width="16" height="22" fill="#f472b6" />
      <rect x="62" y="68" width="16" height="58" fill="#ec4899" />
      <path d="M70 46 C56 24 34 28 41 42 C45 50 60 49 70 46 Z" fill="#f472b6" />
      <path d="M70 46 C84 24 106 28 99 42 C95 50 80 49 70 46 Z" fill="#ec4899" />
      <circle cx="70" cy="46" r="7" fill="#db2777" />
      <path d="M22 24 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 z" fill="#fde68a" />
      <path d="M120 14 l1.5 4.5 4.5 1.5 -4.5 1.5 -1.5 4.5 -1.5 -4.5 -4.5 -1.5 4.5 -1.5 z" fill="#fde68a" />
    </svg>
  );
}

export function TrophyArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 140 140" className={className} aria-hidden>
      <path d="M40 30 H26 a14 14 0 0 0 14 28" fill="none" stroke="#f59e0b" strokeWidth="7" strokeLinecap="round" />
      <path d="M100 30 H114 a14 14 0 0 1 -14 28" fill="none" stroke="#d97706" strokeWidth="7" strokeLinecap="round" />
      <path d="M38 22 H102 V52 a32 32 0 0 1 -64 0 Z" fill="#fbbf24" />
      <path d="M70 22 H102 V52 a32 32 0 0 1 -32 32 Z" fill="#f59e0b" />
      <rect x="34" y="17" width="72" height="9" rx="4.5" fill="#fde68a" />
      <path d="M70 38 L72.9 44.1 L79.5 44.9 L74.6 49.4 L75.9 56 L70 52.7 L64.1 56 L65.4 49.4 L60.5 44.9 L67.1 44.1 Z" fill="#fef3c7" />
      <rect x="63" y="82" width="14" height="16" fill="#d97706" />
      <rect x="46" y="97" width="48" height="10" rx="3" fill="#b45309" />
      <rect x="36" y="105" width="68" height="18" rx="4" fill="#6d28d9" />
      <rect x="56" y="110" width="28" height="8" rx="2" fill="#c4b5fd" />
    </svg>
  );
}
