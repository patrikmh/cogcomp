/**
 * The marks, in one place.
 *
 * Three shapes in this product are drawn rather than typeset — the seal beside
 * an act, the contour loops of the identity composition, and the wordmark — and
 * all three speak the same harmonic language: a circle pushed out of true by
 * three sine harmonics, seeded from an id so the same thing always draws the
 * same shape. That last property is the whole point. A seal is how you recognise
 * an entry before you have read a word of it, so it must be the same seal in
 * every client, not a similar one.
 *
 * These are pure functions returning SVG path data. Nothing here knows about the
 * DOM, React, or a canvas, which is what lets both clients use them: the web
 * renders `<path d={…}>`, and the mobile client hands the same string to
 * `Skia.Path.MakeFromSVGString`. Two renderers, one geometry, no drift.
 *
 * Ported unchanged from the design prototype. If a constant here looks arbitrary
 * it is because it was chosen by eye in the original, and changing it changes
 * every seal every person has already learned to recognise.
 */

/** The deterministic PRNG the design uses everywhere it needs a stable shape. */
export function seed(id: string): () => number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

/**
 * The four rings of an act's seal, on a 64×64 viewBox.
 *
 * A different PRNG from `seed` — this one is the multiply-with-carry the
 * prototype used for seals specifically. Kept distinct on purpose: swapping it
 * for `seed` would be tidier and would silently redraw every seal in the record.
 */
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

/**
 * One organic contour loop, on the identity composition's 280×280 viewBox.
 *
 * Finer than a seal — 96 segments to a seal's 56, and shallower harmonics —
 * because these are drawn large and a seal's roughness reads as texture at 34px
 * and as a wobble at 280.
 */
export function loop(key: string, baseR: number, squash: number): string {
  const rnd = seed(key);
  const harmonics = [0, 1, 2].map(() => ({
    f: 2 + Math.floor(rnd() * 4),
    a: 0.04 + rnd() * 0.12,
    p: rnd() * Math.PI * 2,
  }));
  let d = "";
  for (let i = 0; i <= 96; i++) {
    const th = (i / 96) * Math.PI * 2;
    let r = baseR;
    for (const h of harmonics) r += baseR * h.a * Math.sin(th * h.f + h.p);
    const x = 140 + Math.cos(th) * r;
    const y = 140 + Math.sin(th) * r * squash;
    d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }
  return d + "Z";
}

/** The viewBoxes these are drawn against, so a renderer does not guess. */
export const SEAL_VIEWBOX = 64;
export const COMPOSITION_VIEWBOX = 280;

/**
 * How many loops a ring is drawn with — detail is confidence, made visible.
 *
 * Two unless the reading is tentative or removed. The rule is about how sure the
 * reading is, not about whether you have answered it yet, which is why a
 * confidently offered reading gets the same weight as one you kept.
 */
export function loopsOf(ring: { tentative?: boolean; removed?: boolean }): number[] {
  return !ring.tentative && !ring.removed ? [0, 1] : [0];
}

/** Where ring `i` sits, and how much it is squashed. Shared so both clients
 *  space the composition identically. */
export function ringRadius(i: number, k: number): number {
  return 24 + i * 14 - k * 5;
}
export function ringSquash(i: number): number {
  return 0.86 + (i % 3) * 0.05;
}

/** The fourteen cells under a finding. */
export const STRIP_CELLS = 14;

function distribute(salt: string, n: number): number[] {
  let h = 0;
  for (const c of salt) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
  const cells = Array<number>(STRIP_CELLS).fill(0);
  const order = [...Array(STRIP_CELLS).keys()].sort(() => rnd() - 0.5);
  for (let i = 0; i < Math.max(0, Math.min(n, STRIP_CELLS)); i++) cells[order[i]!] = 1;
  return cells;
}

/**
 * Which of a fortnight's cells a finding lights, and which its other side does.
 *
 * Illustrative about *which* days — the caption says so — and exact about how
 * many: the count is the finding's own `distinct_days`, sitting beside a
 * sentence that states it. An ordering and a stated-against-recorded finding
 * have two sides, and the second never lands on a day the first already holds,
 * because they are the two halves of a pair rather than two tallies.
 *
 * Shared so both clients draw the same fourteen cells for the same finding.
 */
export function stripSeries(pattern: {
  id: string;
  detector: string;
  distinct_days: number;
  occurrences: number;
}): { lit: number[]; second: number[] } {
  const lit = distribute(pattern.id, Math.min(pattern.distinct_days, STRIP_CELLS));
  const twoSided = pattern.detector === "stated-vs-recorded" || pattern.detector === "lag";
  const second = twoSided
    ? distribute(
        pattern.id + "b",
        Math.min(pattern.occurrences - pattern.distinct_days, STRIP_CELLS),
      ).map((v, i) => (v && !lit[i] ? 1 : 0))
    : lit.map(() => 0);
  return { lit, second };
}
