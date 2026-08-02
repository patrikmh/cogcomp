/**
 * How the sphere *behaves* — what state it is in and how loud the voice is.
 *
 * Its shape lives in `blobSphere.ts`; this module is the smaller question of how
 * much that shape should move. Kept separate because the two change for different
 * reasons: the geometry changed completely when the sphere went 3D, and none of
 * these values needed touching.
 */

/** What the blob is doing. Drives amplitude, speed, and glow — nothing else. */
export type BlobState = "idle" | "listening" | "thinking" | "speaking";

export interface BlobMotion {
  /** Multiplier on filament wobble. */
  amplitude: number;
  /** Multiplier on angular speed. */
  speed: number;
  /** 0–1; how far the rim glow extends. */
  glow: number;
}

/**
 * Deliberately narrow ranges. This sits on a screen while someone is talking
 * about something difficult, and a shape that lunges at every state change is
 * distracting in a way that costs them the thought they were having.
 *
 * `listening` is calmer than `idle`, not busier: while the person is speaking the
 * blob should recede. `thinking` is the only state that visibly quickens.
 */
const MOTION: Record<BlobState, BlobMotion> = {
  idle: { amplitude: 1, speed: 1, glow: 0.5 },
  listening: { amplitude: 0.75, speed: 0.7, glow: 0.85 },
  thinking: { amplitude: 1.35, speed: 1.8, glow: 0.6 },
  speaking: { amplitude: 1.15, speed: 1.15, glow: 1 },
};

export function motionFor(state: BlobState): BlobMotion {
  return MOTION[state];
}

/**
 * Fold the live loudness of the voice into the motion.
 *
 * This is what actually syncs the blob to speech. `motionFor(state)` says what
 * kind of thing is happening; `energy` — a 0–1 level read off the clip's envelope
 * at the current playback position — says how loud it is right now.
 *
 * Amplitude gets most of it and speed gets a little. Driving speed hard would make
 * the blob appear to *speed up* on loud syllables, which reads as agitation; what
 * a voice actually does to a shape is make it bigger.
 */
export function withEnergy(motion: BlobMotion, energy: number): BlobMotion {
  const level = Math.min(Math.max(energy, 0), 1);
  return {
    // Never below the base motion: silence between words should settle the shape,
    // not freeze it.
    // Modest, because `pulse()` carries most of the swell now. Pushing amplitude
    // hard here just drives filaments into MAX_EXTENT, where they flatten against
    // the rim and stop moving at exactly the loudest moment.
    amplitude: motion.amplitude * (1 + 0.45 * level),
    speed: motion.speed * (1 + 0.15 * level),
    glow: Math.min(motion.glow + 0.5 * level, 1),
  };
}

/** How much louder speech swells the sphere, as a fraction of its radius. Large
 *  enough to read across a room, small enough not to lunge. */
const PULSE_DEPTH = 0.13;

/**
 * Radius multiplier from live loudness.
 *
 * Applied to the sphere itself rather than to the filaments, which is the whole
 * difference between "moving with the voice" and "wobbling while audio plays".
 * The rim and every filament scale together, so the *silhouette* changes — and
 * the silhouette is what a person actually perceives as something speaking.
 * Filaments squirming inside a fixed outline read as decoration.
 */
export function pulse(energy: number): number {
  const level = Math.min(Math.max(energy, 0), 1);
  return 1 + PULSE_DEPTH * level;
}

/** The largest value `pulse` can return. Callers size the canvas from this so a
 *  loud syllable cannot push the glow past the edge and clip. */
export const MAX_PULSE = 1 + PULSE_DEPTH;
