/**
 * Every act is stamped with its own seal.
 *
 * A contour whorl seeded by the entry id — the same harmonic language as the
 * headspace map and the wordmark, at the smallest of the three scales. Ported
 * unchanged from the design prototype so the shapes are identical: the same id
 * always draws the same seal, which is what makes an entry recognisable at a
 * glance before you have read a word of it.
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

export function sealRings(id: string): string[] {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
  const harmonics = [0, 1, 2].map(() => ({
    f: 2 + Math.floor(rnd() * 4),
    a: 0.06 + rnd() * 0.16,
    p: rnd() * Math.PI * 2,
  }));
  const squash = 0.86 + rnd() * 0.18;

  const rings: string[] = [];
  for (let k = 0; k < 4; k++) {
    const base = 7 + k * 5.4;
    let d = "";
    for (let i = 0; i <= 56; i++) {
      const th = (i / 56) * Math.PI * 2;
      let r = base;
      for (const hm of harmonics) r += base * hm.a * Math.sin(th * hm.f + hm.p + k * 0.5);
      const x = 32 + Math.cos(th) * r;
      const y = 32 + Math.sin(th) * r * squash;
      d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }
    rings.push(d + "Z");
  }
  return rings;
}

/** The deterministic PRNG the design uses everywhere it needs a stable shape. */
export function seed(id: string) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}
