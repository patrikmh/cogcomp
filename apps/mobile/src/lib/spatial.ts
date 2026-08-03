/** Deterministic positions for semantic lights in the observatory. */
export interface SpatialPoint {
  x: number;
  y: number;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/**
 * Place a signal on one of three stable rings. The id is part of the seed so
 * reordering a response does not make a person's constellation jump around.
 * Coordinates are normalized to 0..1 for use in responsive fields.
 */
export function constellationPoint(id: string, index: number): SpatialPoint {
  // Index only breaks a tie for malformed duplicate ids; ordinary nodes are
  // anchored solely by their semantic id.
  const seed = hash(id || `anonymous:${index}`);
  const angle = ((seed % 360) * Math.PI) / 180;
  const ring = 0.22 + ((seed >>> 8) % 3) * 0.12;
  const wobble = (((seed >>> 16) % 1000) / 1000 - 0.5) * 0.06;
  return {
    x: Math.min(0.92, Math.max(0.08, 0.5 + Math.cos(angle) * (ring + wobble))),
    y: Math.min(0.86, Math.max(0.14, 0.5 + Math.sin(angle) * (ring + wobble))),
  };
}

export function spatialDistance(a: SpatialPoint, b: SpatialPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
