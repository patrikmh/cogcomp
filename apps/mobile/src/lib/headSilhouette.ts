/**
 * A head in profile, as a path.
 *
 * The constellation turns *inside* this. That is not decoration: the whole claim
 * of the product is that these are your own thoughts being reflected back, and a
 * graph floating in a void does not say that. A graph turning inside the outline
 * of a head says it without a word of copy.
 *
 * Facing right, because a profile facing the reading direction looks like it is
 * looking forward rather than back.
 *
 * The curve is authored in a normalised 0–1 box and scaled at use, so it fits any
 * canvas and can be checked without rendering. Cubic segments throughout: a head
 * drawn with straight lines reads as a logo, and this needs to read as a person.
 *
 * Anatomy, not a smooth silhouette. The landmarks that make a profile read as
 * bone are the occipital bulge at the back of the cranium, the brow ridge, the
 * nasion recess behind it, a projecting chin, and the gonial angle where the jaw
 * turns up toward the ear. `craniumPath` adds the interior vault line that
 * separates braincase from face.
 */

export interface HeadOptions {
  /** Side of the square box the head is fitted into. */
  size: number;
  /** Fraction of the box the head occupies. Below 1 to leave room for the glow. */
  inset?: number;
}

/**
 * Control points, normalised. Each entry is a cubic segment: two control points
 * and an endpoint, in the SVG `C` sense.
 *
 * Walked clockwise from the base of the neck: up the back of the skull, over the
 * crown, down the forehead, out over the brow, the nose, the lips, the chin, then
 * back along the jaw.
 */
const SEGMENTS: [number, number, number, number, number, number][] = [
  // Back of the skull, with the occipital bulge — the braincase carries further
  // back than a smooth oval does, and that overhang above the neck is the first
  // thing that reads as bone rather than as a head-shaped blob.
  [0.14, 0.80, 0.055, 0.60, 0.085, 0.44],
  // Parietal rise to the crown.
  [0.11, 0.27, 0.26, 0.095, 0.46, 0.06],
  // Frontal bone, coming down the front.
  [0.62, 0.06, 0.755, 0.16, 0.775, 0.28],
  // Brow ridge. A short outward push before the bridge, and the single most
  // skull-like feature on a profile: a smooth forehead reads as a mannequin.
  [0.787, 0.33, 0.817, 0.35, 0.824, 0.385],
  // Nasion — the recess between brow and nose. The step back from the brow is
  // what makes the ridge above it register at all.
  [0.828, 0.40, 0.793, 0.405, 0.788, 0.425],
  // Nasal bone out to the tip.
  [0.83, 0.47, 0.895, 0.545, 0.876, 0.575],
  // Subnasale, tucking back under the nose.
  [0.862, 0.593, 0.816, 0.60, 0.806, 0.625],
  // Upper lip.
  [0.80, 0.645, 0.816, 0.66, 0.803, 0.678],
  // Lower lip and the crease beneath it.
  [0.795, 0.695, 0.816, 0.706, 0.807, 0.735],
  // Chin, projecting slightly rather than sloping away.
  [0.80, 0.776, 0.751, 0.80, 0.686, 0.815],
  // Jawline running back toward the ear.
  [0.60, 0.831, 0.50, 0.846, 0.416, 0.861],
  // Gonial angle — the corner where the jaw turns up toward the ear. Cornered
  // rather than curved: a jaw that arcs smoothly into the neck is a chin on a
  // tube, and this is the landmark that tells you where the jaw *ends*.
  [0.386, 0.876, 0.376, 0.931, 0.373, 1.0],
];

/** Where the outline starts, normalised: the base of the neck at the back. */
const START: [number, number] = [0.30, 1.0];

/**
 * The head outline as an SVG path string.
 *
 * Open at the bottom rather than closed — the neck runs off the edge of the box,
 * which is what makes it a head rather than a balloon. Callers that need a closed
 * region for clipping get one from `headClipPath`.
 */
export function headPath({ size, inset = 0.92 }: HeadOptions): string {
  const scale = size * inset;
  const offsetX = (size - scale) / 2;
  const offsetY = (size - scale) / 2;
  const at = (x: number, y: number) =>
    `${(offsetX + x * scale).toFixed(2)} ${(offsetY + y * scale).toFixed(2)}`;

  const parts = [`M${at(START[0], START[1])}`];
  for (const [c1x, c1y, c2x, c2y, x, y] of SEGMENTS) {
    parts.push(`C${at(c1x, c1y)} ${at(c2x, c2y)} ${at(x, y)}`);
  }
  return parts.join(" ");
}

/**
 * The same outline, closed along the bottom so it can be used as a clip.
 *
 * Clipping the constellation to this is what puts the thoughts inside the head
 * rather than on top of a drawing of one.
 */
export function headClipPath(options: HeadOptions): string {
  return `${headPath(options)} Z`;
}

/**
 * A point roughly at the centre of the skull, where the constellation should sit.
 *
 * Not the centre of the bounding box: a head profile is mostly jaw and neck below
 * the midpoint, so a constellation centred on the box hangs out of the chin.
 */
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
    // Sized to sit inside the cranium rather than fill the whole outline. Kept
    // under a quarter because perspective widens the near face by about a third,
    // and a point that swings past the brow ridge reads as being in the face
    // rather than in the braincase.
    radius: 0.245 * scale,
  };
}

/**
 * The interior line separating the braincase from the face.
 *
 * Runs from just behind the brow ridge, over the temporal region, and down to
 * the occiput. On a real skull this is roughly where the temporal line sits, and
 * on a silhouette it is what turns an outline into a structure — it also marks
 * the volume the constellation occupies, so the thoughts sit in the cranium
 * rather than floating across the face.
 */
export function craniumPath({ size, inset = 0.92 }: HeadOptions): string {
  const scale = size * inset;
  const offset = (size - scale) / 2;
  const at = (x: number, y: number) =>
    `${(offset + x * scale).toFixed(2)} ${(offset + y * scale).toFixed(2)}`;

  return [
    `M${at(0.78, 0.315)}`,
    `C${at(0.66, 0.44)} ${at(0.44, 0.50)} ${at(0.255, 0.455)}`,
    `C${at(0.16, 0.43)} ${at(0.10, 0.40)} ${at(0.086, 0.36)}`,
  ].join(" ");
}
