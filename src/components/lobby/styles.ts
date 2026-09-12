// Shared lobby surfaces. Accent classes read the --lobby-accent vars that
// GamesLobby sets from the casino's primary colour (defaults in index.css).
export const GLASS = "bg-white/5 backdrop-blur-xl border border-white/10";
export const ACCENT_CTA = "bg-[linear-gradient(90deg,rgb(var(--lobby-accent)),#818cf8)] text-white";
export const ACCENT_SOLID = "bg-[rgb(var(--lobby-accent))] text-white";
export const ACCENT_SOFT = "bg-[rgb(var(--lobby-accent)/0.18)]";
export const ACCENT_TEXT = "text-[rgb(var(--lobby-accent-light))]";
export const EMERALD_CTA = "bg-gradient-to-b from-emerald-400 to-emerald-500 text-emerald-950";
// Horizontal swipe rows on small screens: bleed to the viewport edge. The
// scroll padding keeps snap-start from pulling the first item flush left.
export const SWIPE_ROW = "-mx-4 flex snap-x overflow-x-auto px-4 scroll-px-4 no-scrollbar md:scroll-px-0";
