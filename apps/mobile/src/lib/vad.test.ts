import {
  DEFAULTS,
  type VadAction,
  type VadState,
  initial,
  levelFromMetering,
  step,
} from "./vad";

const FRAME = 50;
const LOUD = 0.5;
const QUIET = 0.0;

/** Feed a run of frames and collect everything the detector decided. */
function run(
  frames: { level: number; ms?: number }[],
  from: VadState = initial(),
): { state: VadState; actions: VadAction[] } {
  let state = from;
  const actions: VadAction[] = [];
  for (const frame of frames) {
    const next = step(state, frame.level, frame.ms ?? FRAME);
    state = next.state;
    if (next.action.type !== "none") actions.push(next.action);
  }
  return { state, actions };
}

function frames(level: number, count: number) {
  return Array.from({ length: count }, () => ({ level }));
}

/** Enough quiet frames to close an utterance, with margin. */
const CLOSING_SILENCE = Math.ceil(DEFAULTS.silenceMs / FRAME) + 2;

describe("starting", () => {
  it("stays idle in a quiet room", () => {
    const { state, actions } = run(frames(QUIET, 40));
    expect(state.state).toBe("idle");
    expect(actions).toEqual([]);
  });

  it("opens an utterance when someone speaks", () => {
    const { actions } = run(frames(LOUD, 10));
    expect(actions[0]).toEqual({ type: "start" });
  });

  it("does not open on a single blip", () => {
    // A door, a cough, a chair. One frame above the threshold is not speech.
    const { actions } = run([{ level: LOUD }, ...frames(QUIET, 10)]);
    expect(actions.filter((a) => a.type === "start")).toEqual([]);
  });

  it("opens quickly, so the first syllable is not lost", () => {
    // Whatever else changes, starting has to stay fast.
    expect(DEFAULTS.startMs).toBeLessThanOrEqual(200);
  });
});

describe("stopping", () => {
  it("finishes after a long enough silence", () => {
    const { actions } = run([...frames(LOUD, 20), ...frames(QUIET, CLOSING_SILENCE)]);
    expect(actions.at(-1)).toMatchObject({ type: "finish", reason: "silence" });
  });

  it("does not finish on a pause mid-thought", () => {
    // The whole point. Someone saying "I don't know… what to do about it" must
    // not be cut in half — the pauses are the content in a journal like this.
    const pause = Math.floor(DEFAULTS.silenceMs / FRAME) - 4;
    const { actions } = run([
      ...frames(LOUD, 10),
      ...frames(QUIET, pause),
      ...frames(LOUD, 10),
    ]);
    expect(actions.filter((a) => a.type === "finish")).toEqual([]);
  });

  it("waits much longer to stop than to start", () => {
    // Asymmetric on purpose: cutting someone off is worse than a beat of delay.
    expect(DEFAULTS.silenceMs).toBeGreaterThan(DEFAULTS.startMs * 5);
  });

  it("excludes the trailing silence from what was said", () => {
    const { actions } = run([...frames(LOUD, 20), ...frames(QUIET, CLOSING_SILENCE)]);
    const finish = actions.at(-1) as { durationMs: number };
    // Twenty frames of speech, not twenty plus a second and a half of nothing.
    expect(finish.durationMs).toBeLessThan(20 * FRAME + 200);
    expect(finish.durationMs).toBeGreaterThan(300);
  });

  it("returns to idle so the next utterance can begin", () => {
    const { state } = run([...frames(LOUD, 20), ...frames(QUIET, CLOSING_SILENCE)]);
    expect(state.state).toBe("idle");
  });

  it("can hear a second utterance after the first", () => {
    const { actions } = run([
      ...frames(LOUD, 20),
      ...frames(QUIET, CLOSING_SILENCE),
      ...frames(LOUD, 20),
      ...frames(QUIET, CLOSING_SILENCE),
    ]);
    expect(actions.filter((a) => a.type === "finish")).toHaveLength(2);
    expect(actions.filter((a) => a.type === "start")).toHaveLength(2);
  });
});

describe("what is not worth sending", () => {
  it("discards something too short to be speech", () => {
    // Above the threshold long enough to open, too short to mean anything.
    const { actions } = run([
      ...frames(LOUD, 4),
      ...frames(QUIET, CLOSING_SILENCE),
    ]);
    expect(actions.at(-1)).toEqual({ type: "discard" });
  });

  it("never uploads a discarded utterance", () => {
    const { actions } = run([...frames(LOUD, 4), ...frames(QUIET, CLOSING_SILENCE)]);
    expect(actions.filter((a) => a.type === "finish")).toEqual([]);
  });
});

describe("length ceiling", () => {
  it("cuts an utterance that runs too long", () => {
    // Without a ceiling a noisy room records forever and uploads a minute of
    // nothing.
    const { actions } = run(frames(LOUD, Math.ceil(DEFAULTS.maxMs / FRAME) + 2));
    expect(actions.at(-1)).toMatchObject({ type: "finish", reason: "too-long" });
  });

  it("keeps listening after cutting", () => {
    const { state } = run(frames(LOUD, Math.ceil(DEFAULTS.maxMs / FRAME) + 2));
    expect(state.state).toBe("idle");
  });
});

describe("the noise floor", () => {
  it("ignores steady room tone", () => {
    // A fan, traffic, a laptop. Loud enough to trip a fixed threshold, and
    // present the whole time.
    const hum = DEFAULTS.threshold * 0.9;
    const { actions } = run(frames(hum, 200));
    expect(actions).toEqual([]);
  });

  it("still hears speech over that room tone", () => {
    const hum = DEFAULTS.threshold * 0.9;
    const { actions } = run([...frames(hum, 200), ...frames(hum + 0.4, 10)]);
    expect(actions.filter((a) => a.type === "start")).toHaveLength(1);
  });

  it("settles toward quiet rather than jumping to it", () => {
    // Rising slowly means one loud word cannot raise the floor and deafen the
    // detector to everything after it.
    const after = run(frames(0.9, 40)).state;
    expect(after.floor).toBeLessThan(0.2);
  });
});

describe("frame timing", () => {
  it("does not depend on how often it is called", () => {
    // The same wall-clock silence has to close an utterance whether polling runs
    // at 20Hz or stutters under load.
    const fast = run([
      ...frames(LOUD, 20),
      ...Array.from({ length: 40 }, () => ({ level: QUIET, ms: 50 })),
    ]);
    const slow = run([
      ...Array.from({ length: 10 }, () => ({ level: LOUD, ms: 100 })),
      ...Array.from({ length: 20 }, () => ({ level: QUIET, ms: 100 })),
    ]);
    expect(fast.actions.at(-1)?.type).toBe("finish");
    expect(slow.actions.at(-1)?.type).toBe("finish");
  });

  it("survives a stalled frame without losing the utterance", () => {
    const { actions } = run([
      ...frames(LOUD, 20),
      { level: LOUD, ms: 4000 },
      ...frames(QUIET, CLOSING_SILENCE),
    ]);
    expect(actions.at(-1)?.type).toBe("finish");
  });
});

describe("levelFromMetering", () => {
  it("reads silence as zero", () => {
    expect(levelFromMetering(-160)).toBe(0);
    expect(levelFromMetering(-60)).toBe(0);
  });

  it("reads clipping as one", () => {
    expect(levelFromMetering(0)).toBe(1);
    expect(levelFromMetering(5)).toBe(1);
  });

  it("puts speech in a usable part of the range", () => {
    // Mapping the full -160..0 linearly would squash every human voice into the
    // last few percent, where the threshold cannot distinguish anything.
    const speech = levelFromMetering(-25);
    expect(speech).toBeGreaterThan(0.4);
    expect(speech).toBeLessThan(0.8);
  });

  it("rises with loudness", () => {
    expect(levelFromMetering(-20)).toBeGreaterThan(levelFromMetering(-40));
  });

  it("survives a missing reading", () => {
    // Some platforms report nothing until the first buffer arrives.
    expect(levelFromMetering(NaN)).toBe(0);
    expect(levelFromMetering(-Infinity)).toBe(0);
  });
});
