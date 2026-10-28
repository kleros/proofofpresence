import type { CSSProperties, ReactNode } from "react";

/** Small, stable hash so the same event always gets the same cover. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * A generated cover for events and talks without an image: a Kleros-purple gradient,
 * varied a little per seed (hue, angle, glow and symbol position) so a grid of them
 * doesn't look stamped out, with the Kleros symbol as a soft watermark.
 */
export default function GenCover({ seed, big, small, children, className = "" }: {
  seed: string; big?: string; small?: string; children?: ReactNode; className?: string;
}) {
  const h = hash(seed);
  const style = {
    "--h": 252 + (h % 34),                 // violet to purple
    "--a": `${110 + ((h >> 6) % 70)}deg`,
    "--gx": `${10 + ((h >> 12) % 80)}%`,
    "--gy": `${(h >> 18) % 2 ? 0 : 100}%`,
    "--sx": `${(h >> 3) % 2 ? -8 : 62}%`,
    "--sr": `${((h >> 9) % 40) - 20}deg`,
  } as CSSProperties;
  return (
    <span className={`gen ${className}`} style={style} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="gen-sym" src="/kleros-symbol.svg" alt="" />
      {(big || small) && (
        <span className="gen-text">
          {small && <span className="gen-small">{small}</span>}
          {big && <span className="gen-big">{big}</span>}
        </span>
      )}
      {children}
    </span>
  );
}
