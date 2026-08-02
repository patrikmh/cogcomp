/**
 * Reading an amplitude envelope at a moment in time.
 *
 * The server ships one loudness value per frame of audio (see `tlon/speech.py`).
 * Playback reports a position in milliseconds. This turns the second into the
 * first, which is the whole of what makes the blob move *with* the voice rather
 * than merely move while audio happens to be playing.
 *
 * Two things matter and both are about how it looks rather than how correct it is:
 *
 * - **Interpolate between frames.** Stepping from frame to frame at 20 Hz reads
 *   as a stutter, because 50 ms is slow enough for the eye to resolve.
 * - **Fall, then rise.** Loudness drops faster than a shape can settle. Letting
 *   the level fall instantly makes the blob flicker on every gap between words,
 *   so decay is smoothed and attack is not — the rise should feel immediate.
 */

/** Rate the smoothed level approaches a *lower* target, per second. Attack is
 *  deliberately instant: a blob that swells late reads as lagging the voice. */
const DECAY_PER_SECOND = 6;

export interface Envelope {
  /** One 0–1 value per `frameMs` of audio. */
  levels: number[];
  frameMs: number;
}

/**
 * The level at `positionMs`, linearly interpolated between neighbouring frames.
 *
 * Returns 0 before the clip starts, after it ends, and for an empty envelope —
 * all three mean "nothing is being said", which is the same thing to look at.
 */
export function levelAt(envelope: Envelope, positionMs: number): number {
  const { levels, frameMs } = envelope;
  if (levels.length === 0 || frameMs <= 0 || positionMs < 0) return 0;

  // Sampled at the centre of each frame, so a frame's peak influence lands in the
  // middle of the audio it was measured from rather than at its leading edge.
  const exact = positionMs / frameMs - 0.5;
  if (exact >= levels.length - 1) {
    // Past the last frame centre: hold the final value through the tail rather
    // than cutting to zero mid-syllable.
    return exact >= levels.length ? 0 : levels[levels.length - 1]!;
  }
  if (exact <= 0) return levels[0]!;

  const index = Math.floor(exact);
  const fraction = exact - index;
  const from = levels[index]!;
  const to = levels[index + 1]!;
  return from + (to - from) * fraction;
}

/**
 * Move `current` toward `target`, smoothing the fall but not the rise.
 *
 * `elapsedSeconds` rather than a fixed step so the smoothing is the same whether
 * frames arrive at 30 Hz or stutter under load.
 */
export function smooth(current: number, target: number, elapsedSeconds: number): number {
  if (target >= current) return target;
  const fall = Math.min(DECAY_PER_SECOND * elapsedSeconds, 1);
  return current + (target - current) * fall;
}
