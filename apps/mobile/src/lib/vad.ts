/**
 * Deciding when someone has started and stopped talking.
 *
 * A continuous conversation needs to know two things from the microphone: that a
 * person has begun speaking, and — much harder — that they have *finished*. Get
 * the second wrong in one direction and you cut people off mid-sentence; get it
 * wrong in the other and the pause after "I don't know…" is treated as the end of
 * the thought, which in this app is exactly the moment that mattered.
 *
 * So the rules are deliberately asymmetric:
 *
 * **Starting is fast, stopping is slow.** A short burst above the threshold opens
 * an utterance; closing one takes a full second and a half of quiet. People
 * pause mid-thought constantly, and this is a journal for people working out what
 * they mean — the pauses *are* the content.
 *
 * **Nothing below the floor counts.** Room tone, a fan, traffic. The floor adapts
 * to the quietest thing recently heard, because a threshold that works in a
 * kitchen does not work in an office.
 *
 * **An utterance has a ceiling.** Without one, a noisy room records forever and
 * uploads a minute of nothing. Long speech is cut at the ceiling and sent; the
 * next chunk simply continues.
 *
 * Pure: it takes levels and elapsed time and returns a decision. No microphone,
 * no timers, no platform. That is what makes the hard part — the timing — testable
 * without a device.
 */

export type VoiceState = "idle" | "speaking" | "trailing";

export interface VadConfig {
  /** Level above the noise floor that counts as speech. */
  threshold: number;
  /** How long speech must persist before an utterance opens. Short: the first
   *  syllable should not be lost. */
  startMs: number;
  /** How long it must stay quiet before an utterance closes. Long: a pause in the
   *  middle of a difficult sentence is not the end of it. */
  silenceMs: number;
  /** Longest single utterance before it is cut and sent. */
  maxMs: number;
  /** Shortest utterance worth uploading. Below this it is a cough or a door. */
  minMs: number;
}

export const DEFAULTS: VadConfig = {
  threshold: 0.055,
  startMs: 120,
  silenceMs: 1500,
  maxMs: 30_000,
  minMs: 350,
};

export interface VadState {
  state: VoiceState;
  /** How long the current state has been held, in ms. */
  heldMs: number;
  /** Total length of the utterance in progress. */
  utteranceMs: number;
  /** Rolling estimate of the quietest recent level. */
  floor: number;
}

export function initial(): VadState {
  return { state: "idle", heldMs: 0, utteranceMs: 0, floor: 0.02 };
}

/** What the caller should do as a result of this frame. */
export type VadAction =
  | { type: "none" }
  | { type: "start" }
  /** The utterance is over and worth sending. */
  | { type: "finish"; durationMs: number; reason: "silence" | "too-long" }
  /** It ended but was too short to be speech — discard rather than upload. */
  | { type: "discard" };

/**
 * The noise floor, tracked as the quietest thing heard lately.
 *
 * Falls quickly toward a new quiet level and rises very slowly, so a sustained
 * noise eventually raises it but a single loud word never does. Without this a
 * threshold tuned in one room is useless in the next.
 */
function adapt(floor: number, level: number): number {
  return level < floor ? floor + (level - floor) * 0.25 : floor + (level - floor) * 0.002;
}

/**
 * Advance the detector by one frame.
 *
 * `level` is 0–1 loudness now; `elapsedMs` is time since the previous frame.
 */
export function step(
  previous: VadState,
  level: number,
  elapsedMs: number,
  config: VadConfig = DEFAULTS,
): { state: VadState; action: VadAction } {
  const floor = adapt(previous.floor, level);
  const loud = level > floor + config.threshold;
  const held = previous.heldMs + elapsedMs;

  if (previous.state === "idle") {
    if (!loud) {
      return { state: { ...previous, floor, heldMs: 0, utteranceMs: 0 }, action: { type: "none" } };
    }
    if (held < config.startMs) {
      return { state: { ...previous, floor, heldMs: held }, action: { type: "none" } };
    }
    // Credit the time already spent above the threshold — it was speech, and
    // dropping it clips the first syllable off every sentence.
    return {
      state: { state: "speaking", floor, heldMs: 0, utteranceMs: held },
      action: { type: "start" },
    };
  }

  const utteranceMs = previous.utteranceMs + elapsedMs;

  if (utteranceMs >= config.maxMs) {
    return {
      state: { state: "idle", floor, heldMs: 0, utteranceMs: 0 },
      action: { type: "finish", durationMs: utteranceMs, reason: "too-long" },
    };
  }

  if (previous.state === "speaking") {
    if (loud) {
      return {
        state: { state: "speaking", floor, heldMs: 0, utteranceMs },
        action: { type: "none" },
      };
    }
    // Quiet, but not yet long enough to mean anything.
    return {
      state: { state: "trailing", floor, heldMs: elapsedMs, utteranceMs },
      action: { type: "none" },
    };
  }

  // Trailing: quiet since the last loud frame.
  if (loud) {
    // They were only drawing breath.
    return {
      state: { state: "speaking", floor, heldMs: 0, utteranceMs },
      action: { type: "none" },
    };
  }

  if (held < config.silenceMs) {
    return {
      state: { state: "trailing", floor, heldMs: held, utteranceMs },
      action: { type: "none" },
    };
  }

  // The trailing silence is not part of what they said.
  const spokenMs = utteranceMs - held;
  return {
    state: { state: "idle", floor, heldMs: 0, utteranceMs: 0 },
    action:
      spokenMs >= config.minMs
        ? { type: "finish", durationMs: spokenMs, reason: "silence" }
        : { type: "discard" },
  };
}

/**
 * Convert a platform metering reading in dBFS to a 0–1 level.
 *
 * expo-av reports roughly -160 (silence) to 0 (clipping). The scale is
 * logarithmic and speech lives in a narrow band near the top, so -60 is taken as
 * the practical floor — mapping the whole range linearly would leave every human
 * voice squashed into the last few percent.
 */
export function levelFromMetering(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const floor = -60;
  if (db <= floor) return 0;
  if (db >= 0) return 1;
  return (db - floor) / -floor;
}
