import { sealRings } from "@tlon/design/marks";

/**
 * Every act is stamped with its own seal.
 *
 * A contour whorl seeded by the entry id — the same harmonic language as the
 * headspace map and the wordmark, at the smallest of the three scales. The same
 * id always draws the same seal, which is what makes an entry recognisable at a
 * glance before you have read a word of it.
 *
 * The geometry moved to `packages/design/marks.ts` so the mobile client draws
 * the same shapes rather than its own approximation of them. What is left here
 * is the rendering: an `<svg>` and four `<path>`s.
 */
export function Seal({ id, className = "j-seal" }: { id: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      stroke="var(--line2)"
      strokeWidth="1.1"
      aria-hidden
    >
      {sealRings(id).map((d, i) => (
        <path key={i} d={d} pathLength={1} />
      ))}
    </svg>
  );
}

export { seed, sealRings } from "@tlon/design/marks";
