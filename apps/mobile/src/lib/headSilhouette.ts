/**
 * A head in profile, as a path.
 *
 * The constellation turns *inside* this. That is not decoration: the whole claim
 * of the product is that these are your own thoughts being reflected back, and a
 * graph floating in a void does not say that. A graph turning inside the outline
 * of a head says it without a word of copy.
 *
 * Facing right, because a profile facing the reading direction looks like it is
 * looking forward rather than back. All geometry is authored in a normalised
 * 0–1 box and scaled at use, so it fits any canvas and can be checked without
 * rendering.
 */

export interface HeadOptions {
  /** Side of the square box the head is fitted into. */
  size: number;
  /** Fraction of the box the head occupies. Below 1 to leave room for the glow. */
  inset?: number;
}

type Point = [number, number];
type Segment = [number, number, number, number, number, number];

/** Keep every exported detail on exactly the same scale and inset contract. */
function scaler({ size, inset = 0.92 }: HeadOptions): (point: Point) => string {
  const scale = size * inset;
  const offset = (size - scale) / 2;
  return ([x, y]: Point) =>
    `${(offset + x * scale).toFixed(2)} ${(offset + y * scale).toFixed(2)}`;
}

const SEGMENTS: Segment[] = [
  // Rear neck into the nape.
  [0.32, 0.88, 0.32, 0.78, 0.31, 0.72],
  // A single broad curve makes the nape flow into the occiput.
  [0.30, 0.64, 0.12, 0.61, 0.12, 0.45],
  // Near-round rear and crown.
  [0.12, 0.25, 0.23, 0.07, 0.40, 0.07],
  // Round crown into the quiet forehead.
  [0.57, 0.07, 0.74, 0.12, 0.74, 0.22],
  // The shallow forehead-to-nose notch.
  [0.74, 0.30, 0.72, 0.37, 0.74, 0.43],
  // A small, forward-projecting nose.
  [0.76, 0.49, 0.82, 0.53, 0.85, 0.57],
  // Understated upper lip turn.
  [0.85, 0.59, 0.83, 0.61, 0.79, 0.63],
  // Short mouth-to-chin curve.
  [0.77, 0.65, 0.80, 0.68, 0.77, 0.73],
  // Chin into the underside of the jaw.
  [0.75, 0.77, 0.66, 0.78, 0.60, 0.82],
  // Jaw into the open front neck.
  [0.53, 0.84, 0.45, 0.89, 0.43, 1.0],
];

const START: Point = [0.30, 1.0];

/** The open outline; the neck intentionally runs off the bottom of the box. */
export function headPath(options: HeadOptions): string {
  const at = scaler(options);
  const parts = [`M${at(START)}`];
  for (const [c1x, c1y, c2x, c2y, x, y] of SEGMENTS) {
    parts.push(`C${at([c1x, c1y])} ${at([c2x, c2y])} ${at([x, y])}`);
  }
  return parts.join(" ");
}

/** The outline closed along the bottom for clipping only. */
export function headClipPath(options: HeadOptions): string {
  return `${headPath(options)} Z`;
}

export function skullCentre({ size, inset = 0.92 }: HeadOptions): {
  cx: number;
  cy: number;
  radius: number;
} {
  const scale = size * inset;
  const offset = (size - scale) / 2;
  return {
    cx: offset + 0.44 * scale,
    cy: offset + 0.40 * scale,
    radius: 0.245 * scale,
  };
}

/** Broad, open currents that give the profile a sense of inner movement. */
const FLOW_ARCS: Point[][] = [
  [[0.14, 0.30], [0.25, 0.12], [0.48, 0.08], [0.67, 0.19]],
  [[0.11, 0.47], [0.27, 0.31], [0.49, 0.32], [0.69, 0.44]],
  [[0.15, 0.67], [0.29, 0.55], [0.49, 0.57], [0.65, 0.68]],
];

/** Shorter, quieter traces nested within the broad arcs. */
const NEURAL_TRACES: Point[][] = [
  [[0.23, 0.27], [0.32, 0.20], [0.43, 0.22], [0.51, 0.30]],
  [[0.26, 0.40], [0.35, 0.34], [0.44, 0.36], [0.52, 0.41]],
  [[0.21, 0.54], [0.30, 0.48], [0.40, 0.49], [0.47, 0.55]],
  [[0.30, 0.65], [0.37, 0.60], [0.46, 0.61], [0.53, 0.66]],
];

function openCubicPaths(options: HeadOptions, paths: Point[][]): string[] {
  const at = scaler(options);
  return paths.map(([start, c1, c2, end]) =>
    `M${at(start!)} C${at(c1!)} ${at(c2!)} ${at(end!)}`,
  );
}

export function flowArcPaths(options: HeadOptions): string[] {
  return openCubicPaths(options, FLOW_ARCS);
}

export function neuralTracePaths(options: HeadOptions): string[] {
  return openCubicPaths(options, NEURAL_TRACES);
}
