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
export function loop(key: string, baseR: number, squash?: number): string {
  // The seal's PRNG, not the wordmark's. The design draws a contour loop with
  // the same multiply-with-carry it draws a seal with — this used `seed`, the
  // xorshift the wordmark uses, so every ring in the composition was a
  // different shape from the one the design draws for the same reading.
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
  // Two harmonics, not three, and a shallower floor: `0.05 + rnd() * 0.12`.
  const harmonics = [0, 1].map(() => ({
    f: 2 + Math.floor(rnd() * 4),
    a: 0.05 + rnd() * 0.12,
    p: rnd() * Math.PI * 2,
  }));
  const squashed = squash ?? 0.9 + rnd() * 0.16;
  let d = "";
  // Sixty segments. Ninety-six was this port's own idea, on the grounds that a
  // loop drawn at 280 needs more resolution than a seal at 34 — which is true
  // of a circle and false of this shape, because the harmonics are what the eye
  // reads and they are the same either way.
  for (let i = 0; i <= 60; i++) {
    const th = (i / 60) * Math.PI * 2;
    let r = baseR;
    for (const harmonic of harmonics) {
      r += baseR * harmonic.a * Math.sin(th * harmonic.f + harmonic.p);
    }
    const x = 140 + Math.cos(th) * r;
    const y = 140 + Math.sin(th) * r * squashed;
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

/**
 * Where ring `i` sits, and how much it is squashed. Shared so both clients
 * space the composition identically.
 *
 * The design steps by 13, not 14. A pixel a ring sounds like nothing and is
 * not: by the ninth ring — which this composition reaches once tombstones are
 * drawn outside the budget of seven — the difference is eight pixels, and the
 * outermost loop sits that much closer to the edge of a 280 box whose centre is
 * at 140. The harmonics add up to a third of the base radius on top of that,
 * so the outer ring is exactly where clipping would first show.
 */
export function ringRadius(i: number, k: number): number {
  return 24 + i * 13 - k * 5;
}
/**
 * How much a ring is squashed.
 *
 * Kept for the headspace map, which places whorls itself and needs a stable
 * squash per whorl. The identity composition no longer calls it: the design
 * passes no squash there and lets `loop` draw its own from the same PRNG that
 * shapes the harmonics, so a ring's roundness varies with its id rather than
 * with its position in the stack. Three ranks of squash repeating every third
 * ring is a pattern the eye finds, and there is nothing behind it.
 */
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

/**
 * The headspace map's own rules: how big a whorl is, where it sits, and when it
 * arrives.
 *
 * Size is a property of what the thing is, not of how important someone decided
 * it was: a pattern by how often it returns, a reading by how sure the record
 * is, today by how much is in it. Position is a property of kind too — patterns
 * in a chain across the top, readings in a chain below, today off to one side,
 * you at the fixed point. A survey, not a scatter.
 *
 * Shared because the mobile client draws the same map in two dimensions rather
 * than three, and a second copy of these numbers would be a second map.
 */
export type WhorlGroup = "you" | "pattern" | "reading" | "today";

export function whorlRadius(group: WhorlGroup, R: number, weight = 0, bar = 0): number {
  if (group === "you") return R * 0.52;
  if (group === "pattern") return R * (0.18 + 0.46 * bar);
  if (group === "today") return R * (0.05 + 0.013 * weight * 14);
  return R * (0.05 + 0.18 * weight);
}

/** Evenly along a chain, centred: -span at one end, +span at the other. */
export function chainX(i: number, n: number, span: number): number {
  return n === 1 ? 0 : -span + (2 * span * i) / (n - 1);
}

/** When each whorl starts arriving, in seconds. You first, because you were
 *  here before any of it. */
export function arriveAt(group: WhorlGroup, i: number): number {
  if (group === "you") return 0;
  if (group === "pattern") return 0.35 + i * 0.22;
  if (group === "today") return 2.2;
  return 1.1 + i * 0.15;
}

/** Back-out easing: a slight overshoot, so a peak is placed rather than faded. */
export function backOut(k: number): number {
  if (k >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}

/**
 * Whorls the survey draws before it becomes a fog. Counts you and today.
 *
 * The camera frames the whole massif, so every extra whorl shrinks all the
 * others: past this the patterns stop reading as massifs and the labels stop
 * being legible, which is the map losing the two things it exists to show.
 * Patterns are never dropped — they are the point — so the readings give way.
 */
export const WHORL_BUDGET = 20;

/** How many readings fit alongside the patterns, never fewer than six. */
export function readingBudget(patternCount: number): number {
  return Math.max(6, WHORL_BUDGET - patternCount);
}

/**
 * A count of days, framed by the fortnight only when it fits inside one.
 *
 * "5 of 14 days" is informative; "18 of 14 days" is nonsense, and a record
 * older than two weeks produces the second. The design's fixtures never exceed
 * fourteen, so the framing always looks safe in the prototype — which is how
 * this was written three times in three components before it was written once
 * here.
 */
export function daysOfFortnight(days: number): string {
  return days <= STRIP_CELLS ? `${days} of ${STRIP_CELLS}` : `${days}`;
}
