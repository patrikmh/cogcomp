import { type BlobState, MAX_PULSE, motionFor, pulse, withEnergy } from "./blobShape";

const STATES: BlobState[] = ["idle", "listening", "thinking", "speaking"];

describe("motionFor", () => {
  it("covers every state", () => {
    for (const state of STATES) {
      expect(motionFor(state)).toBeDefined();
    }
  });

  it("recedes while the person is talking", () => {
    // Listening is calmer than idle, not busier. The sphere should get out of the
    // way of the thought someone is in the middle of having.
    expect(motionFor("listening").amplitude).toBeLessThan(motionFor("idle").amplitude);
    expect(motionFor("listening").speed).toBeLessThan(motionFor("idle").speed);
  });

  it("only quickens noticeably while thinking", () => {
    for (const state of STATES.filter((s) => s !== "thinking")) {
      expect(motionFor(state).speed).toBeLessThan(motionFor("thinking").speed);
    }
  });

  it("keeps every state within a calm range", () => {
    // This sits on screen while someone talks about something difficult. Nothing
    // here should lunge.
    for (const state of STATES) {
      const motion = motionFor(state);
      expect(motion.amplitude).toBeLessThanOrEqual(1.5);
      expect(motion.speed).toBeLessThanOrEqual(2);
      expect(motion.glow).toBeGreaterThanOrEqual(0);
      expect(motion.glow).toBeLessThanOrEqual(1);
    }
  });
});

describe("withEnergy", () => {
  const base = motionFor("speaking");

  it("leaves the motion alone at zero", () => {
    expect(withEnergy(base, 0)).toEqual(base);
  });

  it("swells with loudness", () => {
    expect(withEnergy(base, 1).amplitude).toBeGreaterThan(base.amplitude);
  });

  it("never shrinks below the base motion", () => {
    // Silence between words should settle the shape, not freeze it.
    for (const level of [0, 0.2, 0.5, 1]) {
      expect(withEnergy(base, level).amplitude).toBeGreaterThanOrEqual(base.amplitude);
    }
  });

  it("moves size far more than speed", () => {
    // Driving speed hard reads as agitation. What a voice does to a shape is make
    // it bigger, not faster. Compared as fractional increases, since 1.0× is the
    // no-change baseline and the raw ratios are not comparable to each other.
    const loud = withEnergy(base, 1);
    const sizeIncrease = loud.amplitude / base.amplitude - 1 + (pulse(1) - 1);
    const speedIncrease = loud.speed / base.speed - 1;
    expect(sizeIncrease).toBeGreaterThan(speedIncrease * 2);
  });

  it("keeps glow within range", () => {
    for (const level of [0, 0.5, 1, 4, -3]) {
      const glow = withEnergy(base, level).glow;
      expect(glow).toBeGreaterThanOrEqual(0);
      expect(glow).toBeLessThanOrEqual(1);
    }
  });

  it("clamps a level outside 0–1 rather than distorting", () => {
    expect(withEnergy(base, 5)).toEqual(withEnergy(base, 1));
    expect(withEnergy(base, -1)).toEqual(withEnergy(base, 0));
  });
});

describe("pulse", () => {
  it("leaves the sphere alone in silence", () => {
    expect(pulse(0)).toBe(1);
  });

  it("swells the sphere with loudness", () => {
    // The silhouette is what reads as speaking. Detail squirming inside a fixed
    // outline reads as decoration.
    expect(pulse(1)).toBeGreaterThan(pulse(0));
  });

  it("rises monotonically", () => {
    let previous = pulse(0);
    for (let level = 0.05; level <= 1; level += 0.05) {
      const next = pulse(level);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });

  it("never exceeds MAX_PULSE", () => {
    for (const level of [0, 0.5, 1, 9, -4]) {
      expect(pulse(level)).toBeLessThanOrEqual(MAX_PULSE);
    }
  });

  it("clamps rather than distorting outside 0–1", () => {
    expect(pulse(7)).toBe(pulse(1));
    expect(pulse(-2)).toBe(pulse(0));
  });

  it("is a visible change, not a subtlety", () => {
    // The first attempt moved the shape so little that the sync was invisible
    // even though the numbers driving it were correct.
    expect(pulse(1)).toBeGreaterThan(1.08);
  });

  it("stays calm enough not to lunge", () => {
    expect(pulse(1)).toBeLessThan(1.25);
  });
});
