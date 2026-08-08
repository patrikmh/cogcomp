import { describe, expect, it } from "vitest";

import { stripSeries } from "./Patterns";

/**
 * The fourteen cells under a finding.
 *
 * This used to say the two-sided case could not be reached with real data, on
 * the evidence that twelve bad nights each followed by a foggy morning produced
 * no ordering. That was the wrong conclusion from a real observation. The
 * reason those nights produced nothing is that the extractor called them Events
 * and Thoughts, and `PATTERNABLE_KINDS` deliberately holds neither — so they
 * were never eligible, whatever their timing. With patternable kinds an
 * ordering forms readily: `sleeping badly came up 1 day before foggy · 4 of 5
 * times` is on screen, and its second-side bar measures identically to the
 * design's.
 *
 * The unit tests stay, because they cover the arithmetic more cheaply and more
 * completely than a seeded account can.
 */
const pattern = (over: Partial<Parameters<typeof stripSeries>[0]> = {}) => ({
  id: "p1",
  detector: "exact-label" as const,
  distinct_days: 5,
  occurrences: 9,
  ...over,
});

describe("stripSeries", () => {
  it("lights one cell per day the finding rests on", () => {
    const { lit } = stripSeries(pattern({ distinct_days: 5 }));
    expect(lit.filter(Boolean)).toHaveLength(5);
  });

  it("never draws more than a fortnight", () => {
    const { lit } = stripSeries(pattern({ distinct_days: 40, occurrences: 60 }));
    expect(lit).toHaveLength(14);
    expect(lit.filter(Boolean)).toHaveLength(14);
  });

  it("gives a recurrence no second side, because it has none", () => {
    const { second } = stripSeries(pattern({ detector: "exact-label" }));
    expect(second.filter(Boolean)).toHaveLength(0);
  });

  it("gives an ordering a second side", () => {
    const { second } = stripSeries(pattern({ detector: "lag" }));
    expect(second.filter(Boolean).length).toBeGreaterThan(0);
  });

  it("gives a stated-against-recorded finding a second side", () => {
    const { second } = stripSeries(pattern({ detector: "stated-vs-recorded" }));
    expect(second.filter(Boolean).length).toBeGreaterThan(0);
  });

  it("never puts both sides on the same day — they are the two halves of a pair", () => {
    const { lit, second } = stripSeries(pattern({ detector: "lag" }));
    for (let i = 0; i < 14; i++) {
      expect(lit[i] && second[i]).toBeFalsy();
    }
  });

  it("is stable — the same finding draws the same strip", () => {
    expect(stripSeries(pattern({ detector: "lag" }))).toEqual(
      stripSeries(pattern({ detector: "lag" })),
    );
  });

  it("gives different findings different strips", () => {
    expect(stripSeries(pattern({ id: "a" })).lit).not.toEqual(stripSeries(pattern({ id: "b" })).lit);
  });
});
