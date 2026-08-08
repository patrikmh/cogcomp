import { describe, expect, it } from "vitest";

import { stripSeries } from "./Patterns";

/**
 * The fourteen cells under a finding.
 *
 * This is tested here rather than through the app because the two-sided case
 * cannot be reached with real data. An ordering finding needs the same reading
 * on both of its days, and the extractor gives the same sentence different
 * kinds on different days often enough that no pair clears the detector's
 * floor — twelve bad nights, every one followed by a foggy morning, produced no
 * ordering at all. The drawing should still be right for when it does.
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
