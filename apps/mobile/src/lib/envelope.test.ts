import { type Envelope, levelAt, smooth } from "./envelope";

const FRAME_MS = 50;

function envelope(levels: number[], frameMs = FRAME_MS): Envelope {
  return { levels, frameMs };
}

/** The centre of frame `i`, which is where its measured value applies. */
function centre(index: number): number {
  return (index + 0.5) * FRAME_MS;
}

describe("levelAt", () => {
  it("returns each frame's own value at its centre", () => {
    const e = envelope([0.2, 0.9, 0.4]);
    expect(levelAt(e, centre(0))).toBeCloseTo(0.2, 6);
    expect(levelAt(e, centre(1))).toBeCloseTo(0.9, 6);
    expect(levelAt(e, centre(2))).toBeCloseTo(0.4, 6);
  });

  it("interpolates between frames", () => {
    // Stepping frame to frame at 20 Hz reads as a stutter — 50 ms is slow enough
    // for the eye to resolve.
    const e = envelope([0, 1]);
    expect(levelAt(e, (centre(0) + centre(1)) / 2)).toBeCloseTo(0.5, 6);
  });

  it("moves continuously across the whole clip", () => {
    const e = envelope([0.1, 0.9, 0.2, 0.8]);
    let previous = levelAt(e, 0);
    for (let ms = 1; ms < 200; ms += 1) {
      const level = levelAt(e, ms);
      // No jump larger than one frame's worth of change per millisecond.
      expect(Math.abs(level - previous)).toBeLessThan(0.05);
      previous = level;
    }
  });

  it("holds the first value before the first frame centre", () => {
    // Rather than fading in from zero, which would clip the start of a word.
    expect(levelAt(envelope([0.7, 0.2]), 0)).toBeCloseTo(0.7, 6);
  });

  it("holds the last value through the tail", () => {
    // Cutting to zero mid-syllable is worse than holding a beat too long.
    expect(levelAt(envelope([0.2, 0.6]), centre(1) + 10)).toBeCloseTo(0.6, 6);
  });

  it("is silent once the clip has finished", () => {
    expect(levelAt(envelope([0.5, 0.5]), 5000)).toBe(0);
  });

  it("is silent for an empty envelope", () => {
    expect(levelAt(envelope([]), 100)).toBe(0);
  });

  it("is silent before playback starts", () => {
    expect(levelAt(envelope([0.5]), -20)).toBe(0);
  });

  it("survives a nonsense frame size rather than dividing by zero", () => {
    expect(levelAt(envelope([0.5], 0), 10)).toBe(0);
  });

  it("never leaves the range its inputs are in", () => {
    const e = envelope([0, 0.3, 1, 0.6, 0]);
    for (let ms = 0; ms < 300; ms += 3) {
      const level = levelAt(e, ms);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });
});

describe("smooth", () => {
  it("rises instantly", () => {
    // A blob that swells late reads as lagging the voice.
    expect(smooth(0.1, 0.9, 1 / 30)).toBe(0.9);
  });

  it("falls gradually", () => {
    const next = smooth(1, 0, 1 / 30);
    expect(next).toBeLessThan(1);
    expect(next).toBeGreaterThan(0);
  });

  it("keeps falling toward the target", () => {
    let level = 1;
    for (let i = 0; i < 30; i++) level = smooth(level, 0, 1 / 30);
    expect(level).toBeLessThan(0.05);
  });

  it("does not overshoot on a long frame", () => {
    // A stalled frame must not send the level negative.
    expect(smooth(1, 0, 10)).toBeGreaterThanOrEqual(0);
  });

  it("is frame-rate independent", () => {
    // The same smoothing whether frames arrive at 30 Hz or stutter under load.
    let fast = 1;
    for (let i = 0; i < 60; i++) fast = smooth(fast, 0, 1 / 60);
    let slow = 1;
    for (let i = 0; i < 15; i++) slow = smooth(slow, 0, 1 / 15);
    expect(fast).toBeCloseTo(slow, 1);
  });

  it("holds steady when already at the target", () => {
    expect(smooth(0.4, 0.4, 1 / 30)).toBe(0.4);
  });
});
