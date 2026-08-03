/**
 * The sphere, in 3D.
 *
 * A cage of orbiting rings — great circles at different orientations — rotating
 * as one body. Depth is real: every point is a 3D coordinate, rotated by matrices
 * and projected through a perspective divide. That is what makes it read as an
 * object you could reach into rather than a flat doodle that happens to wobble.
 *
 * Skia is a 2D canvas, so the projection is done here rather than by a GPU. That
 * is a deliberate trade: three.js or expo-gl would give real 3D but would replace
 * the entire render path and add a native dependency, and a few hundred points
 * per frame is nothing. The win is that all of this stays pure arithmetic —
 * testable in plain node, no canvas, no GPU.
 *
 * Rendering order matters and is the caller's job made easy: `project()` returns
 * rings sorted **far to near**, so painting them in order gives correct occlusion
 * without a depth buffer. Each ring also carries a `depth` in 0–1 that the caller
 * turns into opacity and stroke width — the two cues that sell perspective on a
 * shape with no lighting.
 */

/** Distance from the eye to the centre of the sphere, in sphere radii. Small
 *  enough that perspective is visible, large enough that the near face does not
 *  balloon grotesquely. */
const FOCAL = 3.2;

/** How far the sphere tips toward the viewer, in radians. A pure side-on view
 *  makes the rings collapse to lines at the poles and reads as flat. */
const TILT = 0.42;

export interface Point2 {
  x: number;
  y: number;
}

/**
 * A run of consecutive points on one side of the view plane.
 *
 * Rings are split into near and far arcs rather than drawn whole, because a great
 * circle centred on the origin has a mean depth of exactly zero — it has a near
 * half *and* a far half, so there is no single depth for the ring and no correct
 * order to paint it in. Splitting at the z crossing gives each piece a real depth,
 * which makes both the sort and the brightness cue meaningful: the far half of a
 * ring passes behind the body and dims, the near half comes forward and brightens.
 * That contrast within a single ring is most of what sells the volume.
 */
export interface ProjectedArc {
  points: Point2[];
  /** 0 = furthest from the viewer, 1 = nearest. Drives opacity and width. */
  depth: number;
  /** Which ring this arc belongs to. Stable across frames, unlike array order,
   *  which changes as arcs orbit past each other. */
  index: number;
}

export interface SphereOptions {
  cx: number;
  cy: number;
  /** Radius of the sphere at rest, in pixels. */
  radius: number;
  /** Points per ring. 64 is smooth at every size this renders at. */
  segments?: number;
}

/**
 * Ring orientations, as (tilt about X, turn about Y) in radians.
 *
 * Hand-picked rather than evenly spaced. Evenly spaced great circles produce a
 * regular wireframe that reads as a globe or a loading spinner; irregular ones
 * read as something tangled and alive. The spread is deliberate — no two rings
 * share a plane, so none of them ever fully overlap.
 */
const RINGS = [
  { tilt: 0, turn: 0, scale: 1.0 },
  { tilt: 1.1, turn: 0.4, scale: 0.94 },
  { tilt: 0.55, turn: 1.25, scale: 0.88 },
  { tilt: 1.45, turn: 2.1, scale: 0.97 },
  { tilt: 0.3, turn: 2.75, scale: 0.82 },
  { tilt: 1.0, turn: 3.6, scale: 0.91 },
];

export const RING_COUNT = RINGS.length;

/** How fast the whole body turns, in radians per second. Slow: this sits on a
 *  screen while someone thinks, and a fast spinner demands attention it has not
 *  earned. */
const SPIN_RATE = 0.32;

/** Depth of the slow nod about X, so the sphere is never seen from exactly one
 *  angle for long. */
const NOD_DEPTH = 0.18;

function rotateX(p: [number, number, number], a: number): [number, number, number] {
  const [x, y, z] = p;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}

function rotateY(p: [number, number, number], a: number): [number, number, number] {
  const [x, y, z] = p;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}

/**
 * How far a ring bulges from a perfect circle at this angle and time.
 *
 * Without it the rings are geometric circles and the thing reads as a wireframe
 * globe. With it they breathe, and the object reads as something living that
 * happens to be round.
 */
function bulge(ringIndex: number, angle: number, time: number, wobble: number): number {
  return 1 + wobble * Math.sin(3 * angle + ringIndex * 1.7 + time * 1.3);
}

/**
 * Project the whole sphere for one frame.
 *
 * `energy` (0–1, the live loudness of the voice) swells the body; `wobble` is how
 * far the rings depart from circles. Returned far-to-near, so painting in order
 * gives correct occlusion.
 */
export function project(
  time: number,
  options: SphereOptions,
  { energy = 0, wobble = 0.07, spin = SPIN_RATE, rotation }: {
    energy?: number;
    wobble?: number;
    spin?: number;
    rotation?: number;
  } = {},
): ProjectedArc[] {
  const { cx, cy, radius, segments = 64 } = options;
  const level = Math.min(Math.max(energy, 0), 1);
  // Applied to the projected radius so the whole body scales uniformly rather
  // than distorting perspective.
  const factor = 1 + 0.16 * level;

  const spinAngle = rotation ?? time * spin;
  const nod = TILT + NOD_DEPTH * Math.sin(time * 0.23);

  const arcs: ProjectedArc[] = [];

  RINGS.forEach((ring, index) => {
    const projected: { point: Point2; z: number }[] = [];

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const r = ring.scale * bulge(index, angle, time, wobble);

      // The ring in its own plane, then into the body's frame, then the body's
      // own rotation. Order matters: the ring's orientation must be applied
      // before the global spin, or every ring would turn about its own axis
      // instead of orbiting with the body.
      let p: [number, number, number] = [Math.cos(angle) * r, Math.sin(angle) * r, 0];
      p = rotateX(p, ring.tilt);
      p = rotateY(p, ring.turn);
      p = rotateY(p, spinAngle);
      p = rotateX(p, nod);

      // Weak perspective. Points nearer the eye (larger z) project larger.
      const scale = (FOCAL / (FOCAL - p[2])) * factor;
      projected.push({
        point: { x: cx + p[0] * scale * radius, y: cy + p[1] * scale * radius },
        z: p[2],
      });
    }

    for (const run of splitAtCrossings(projected)) {
      const meanZ = run.reduce((sum, s) => sum + s.z, 0) / run.length;
      arcs.push({
        points: run.map((s) => s.point),
        depth: (meanZ + 1) / 2,
        index,
      });
    }
  });

  // Painter's algorithm: furthest first.
  arcs.sort((a, b) => a.depth - b.depth);
  return arcs;
}

/**
 * Break a closed loop into runs that stay on one side of the view plane.
 *
 * The loop is rotated so it starts at a crossing, which keeps the run that
 * straddles the array boundary in one piece — otherwise the ring would always
 * show a seam at whichever point happened to be index 0.
 */
function splitAtCrossings<T extends { z: number }>(loop: T[]): T[][] {
  if (loop.length === 0) return [];

  const start = loop.findIndex(
    (s, i) => s.z >= 0 !== loop[(i + loop.length - 1) % loop.length]!.z >= 0,
  );
  // No crossing at all: the ring lies entirely in front of or behind the centre.
  if (start === -1) return [loop];

  const ordered = [...loop.slice(start), ...loop.slice(0, start)];
  const runs: T[][] = [];
  let current: T[] = [];

  for (const sample of ordered) {
    if (current.length > 0 && current[0]!.z >= 0 !== sample.z >= 0) {
      // Overlap by one point so the arcs meet rather than leaving a gap.
      current.push(sample);
      runs.push(current);
      current = [];
    }
    current.push(sample);
  }
  if (current.length > 1) runs.push(current);
  return runs;
}

/** Scale points away from the centre. Used for the voice-driven swell, which must
 *  move the silhouette — a shape that only wriggles internally does not read as
 *  speaking. */
export function swell(points: Point2[], cx: number, cy: number, factor: number): Point2[] {
  return points.map((p) => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
  }));
}

/** An arc as an SVG path. Open, not closed: an arc is half a ring, and closing it
 *  would draw a chord straight through the middle of the sphere. A string so this
 *  module stays free of Skia. */
export function toPath(points: Point2[]): string {
  if (points.length === 0) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
}

/** The largest factor the body can reach, so callers can size the canvas such
 *  that a loud syllable never clips against the edge. */
export const MAX_EXTENT = 1.16 * (FOCAL / (FOCAL - 1));
