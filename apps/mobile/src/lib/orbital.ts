/**
 * Placing data in three dimensions.
 *
 * Every screen in this app is about a *set of things* — entries, inferences,
 * patterns, agent runs. Rendered as lists they all look identical and the screen
 * fills with text nobody reads. Placed on a rotating sphere they become an object
 * you can look at, turn, and point at, and the screen holds one thing instead of
 * forty.
 *
 * Three properties this has to have, and they are the whole design:
 *
 * **Position is deterministic.** A point's place comes from its id, not from
 * render order or a random seed. Open the same screen twice and your things are
 * where you left them — the spatial memory that makes an object navigable at all.
 * The graph explorer's force layout is deterministic for exactly this reason.
 *
 * **Depth is real.** Points are rotated as 3D coordinates and divided through a
 * perspective, then sorted far to near. Size, brightness and blur all follow from
 * depth, so the near face reads as near without any lighting model.
 *
 * **Nothing here draws.** Pure arithmetic, so it can be tested in plain node
 * without a canvas — same split as `blobSphere.ts`, which does the same job for
 * the avatar.
 */

/** Distance from the eye to the centre, in radii. Close enough that perspective
 *  is legible, far enough that the near face does not balloon. */
const FOCAL = 3.4;

/** How far the constellation tips toward the viewer. A pure equatorial view
 *  collapses the poles and reads flat. */
const TILT = 0.38;

export interface Placed {
  id: string;
  /** Unit-sphere coordinates. Scaled to pixels at projection time. */
  x: number;
  y: number;
  z: number;
  /** 0–1. Drives radius — confidence, recurrence count, whatever the screen is
   *  about. Carried through rather than interpreted here. */
  weight: number;
  /** Palette key, e.g. a node kind. Never interpreted here. */
  tone: string;
  /** Drawn hollow rather than filled. A guess should look like a guess. */
  tentative: boolean;
  status?: string | null;
}

export interface Projected extends Placed {
  /** Screen coordinates. */
  sx: number;
  sy: number;
  /** 0 = furthest, 1 = nearest. Opacity, size and blur all follow this. */
  depth: number;
  /** Perspective scale at this point's depth. */
  scale: number;
}

export interface Datum {
  id: string;
  weight?: number;
  tone?: string;
  tentative?: boolean;
  /** What the person has said about this reading, if anything. Moves it in or
   *  out of the body — see `driftFor`. */
  status?: string | null;
}

export interface SceneOptions {
  cx: number;
  cy: number;
  radius: number;
}

/** Deterministic hash of an id to [0, 1). The same string always lands in the
 *  same place, which is what makes the arrangement memorable. */
function seeded(id: string, salt: number): number {
  let hash = salt;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return ((hash >>> 0) % 100000) / 100000;
}

/** The golden angle. Successive multiples of it never repeat a longitude, which
 *  is why a Fibonacci sphere spreads points evenly instead of banding them. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Spread data over a sphere, evenly and repeatably.
 *
 * A Fibonacci lattice rather than random placement: random points clump, and a
 * clump reads as a meaningful cluster when it means nothing at all. The lattice
 * is perfectly even, so any grouping the eye finds is one the caller put there.
 *
 * The per-point jitter is seeded from the id, so it survives reordering — adding
 * an entry must not shuffle everything you had already learned the position of.
 */
export function place(data: Datum[]): Placed[] {
  const count = Math.max(data.length, 1);

  return data.map((datum, index) => {
    const drift = driftFor(datum.status);
    // Latitude walks evenly from pole to pole; longitude turns by the golden
    // angle each step.
    const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
    const ringRadius = Math.sqrt(Math.max(1 - y * y, 0));
    // The id-seeded nudge keeps two adjacent points from looking mechanical
    // without letting either drift far enough to swap places.
    const theta = index * GOLDEN_ANGLE + seeded(datum.id, 11) * 0.35;

    return {
      id: datum.id,
      x: Math.cos(theta) * ringRadius * drift,
      y: y * drift,
      z: Math.sin(theta) * ringRadius * drift,
      weight: Math.min(Math.max(datum.weight ?? 0.6, 0), 1),
      tone: datum.tone ?? "default",
      tentative: datum.tentative ?? false,
      status: datum.status ?? null,
    };
  });
}

function rotateY(p: Placed, a: number): [number, number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p.x * c + p.z * s, p.y, -p.x * s + p.z * c];
}

/**
 * Rotate and project for one frame. Returned far to near.
 *
 * Painting in the returned order gives correct occlusion with no depth buffer,
 * which is the only reason this is affordable on a 2D canvas.
 */
export function project(
  placed: Placed[],
  time: number,
  options: SceneOptions,
  { spin = 0.18, drag = 0 }: { spin?: number; drag?: number } = {},
): Projected[] {
  const { cx, cy, radius } = options;
  const angle = time * spin + drag;
  const nod = TILT;
  const cosNod = Math.cos(nod);
  const sinNod = Math.sin(nod);

  const projected = placed.map((point) => {
    const [rx, ry, rz] = rotateY(point, angle);
    // Tip toward the viewer.
    const ty = ry * cosNod - rz * sinNod;
    const tz = ry * sinNod + rz * cosNod;

    const scale = FOCAL / (FOCAL - tz);
    return {
      ...point,
      sx: cx + rx * scale * radius,
      sy: cy + ty * scale * radius,
      depth: (tz + 1) / 2,
      scale,
    };
  });

  projected.sort((a, b) => a.depth - b.depth);
  return projected;
}

/** Radius a point is drawn at, in pixels. Weight is the signal; depth only
 *  modulates it, so a heavy point at the back still reads as heavier than a
 *  light one at the front. */
export function radiusOf(point: Projected, base: number): number {
  return base * (0.55 + 0.75 * point.weight) * (0.65 + 0.5 * point.depth);
}

/**
 * The point under a tap, or null.
 *
 * Nearer points win ties, because they are the ones drawn on top — picking the
 * one you cannot see is the kind of bug that makes an interface feel haunted.
 */
export function pick(
  projected: Projected[],
  x: number,
  y: number,
  tolerance: number,
): Projected | null {
  let best: Projected | null = null;
  let bestScore = Infinity;

  for (const point of projected) {
    const distance = Math.hypot(point.sx - x, point.sy - y);
    if (distance > tolerance) continue;
    // Distance dominates; depth only breaks near-ties, so a far point directly
    // under the finger still beats a near one an inch away.
    const score = distance - point.depth * tolerance * 0.35;
    if (score < bestScore) {
      best = point;
      bestScore = score;
    }
  }
  return best;
}

/** Links between placed points, for screens that show relationships. Endpoints
 *  that are not in the scene are dropped rather than crashing — the API prunes
 *  these, but a client should not fall over if one slips through. */
export function linkPairs(
  projected: Projected[],
  links: { from: string; to: string }[],
): { from: Projected; to: Projected; depth: number }[] {
  const byId = new Map(projected.map((p) => [p.id, p]));
  const pairs = [];
  for (const link of links) {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) continue;
    pairs.push({ from, to, depth: (from.depth + to.depth) / 2 });
  }
  pairs.sort((a, b) => a.depth - b.depth);
  return pairs;
}

/**
 * A great circle around the scene, in screen coordinates.
 *
 * The constellation needs a horizon. With forty points the sphere is obvious from
 * the distribution alone; with four it reads as a few dots floating in a void, and
 * the turning means nothing because there is no surface to turn. One faint ring
 * establishes the object, and everything else is then read as sitting on it.
 *
 * `tilt` is the ring's own inclination, so two rings at different tilts cross and
 * the crossing is what sells the volume.
 */
export function ringPoints(
  time: number,
  options: SceneOptions,
  { tilt = 0, spin = 0.18, drag = 0, segments = 96 }: {
    tilt?: number;
    spin?: number;
    drag?: number;
    segments?: number;
  } = {},
): Projected[] {
  const ring: Placed[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    // A circle in the XZ plane, tipped by `tilt` about X, so it is a great
    // circle of the same sphere the data points sit on.
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    ring.push({
      id: `ring-${tilt}-${i}`,
      x,
      y: -z * Math.sin(tilt),
      z: z * Math.cos(tilt),
      weight: 0,
      tone: "ring",
      tentative: false,
    });
  }
  // Projected but *not* re-sorted by depth: a ring has to be drawn in angular
  // order or it becomes a scribble.
  const projected = project(ring, time, options, { spin, drag });
  const byIndex = new Map(projected.map((p) => [p.id, p]));
  return ring.map((p) => byIndex.get(p.id)!);
}

/**
 * How far out from the body a point sits, by what the person has said about it.
 *
 * Judgement is currently a database column and a coloured button. This makes it
 * physical: a reading you rejected drifts out of the skull and dims, and one you
 * confirmed pulls in and holds still. The consequence of disagreeing becomes
 * something you watch happen rather than something you are told about.
 *
 * Rejected points are pushed out rather than removed. They are still part of the
 * record — the system did think this, and deleting the evidence of that would
 * make it impossible to notice it keeps making the same mistake. Out at the edge
 * and faint is the honest position: present, not counted.
 */
export function driftFor(status: string | null | undefined): number {
  if (status === "user_rejected") return 1.28;
  // Confirmed things sit slightly inside the shell of unexamined ones, so the
  // things you have actually agreed with form a core.
  if (status === "user_confirmed") return 0.88;
  return 1;
}

/** How brightly a point is drawn, by judgement. Rejected readings stay legible —
 *  findable if you go looking — without competing with anything current. */
export function opacityFor(status: string | null | undefined): number {
  if (status === "user_rejected") return 0.3;
  if (status === "user_confirmed") return 1;
  return 0.85;
}
