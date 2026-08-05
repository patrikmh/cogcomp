import type { Detector, Pattern } from "./api";
import { patternDestination, patternMeta } from "./patterns";

function pattern(detector: Detector, overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: "pattern-1",
    label: "dread",
    confidence: 0.8,
    epistemic_status: "hypothesis",
    extractor: "patterns-v0.1",
    occurrences: 4,
    distinct_days: 3,
    detector,
    first_seen_at: "2026-03-01T09:00:00Z",
    tentative: false,
    created_at: "2026-03-01T09:00:00Z",
    ...overrides,
  };
}

describe("how a pattern reads", () => {
  it("counts entries and days for a recurrence", () => {
    expect(patternMeta(pattern("exact-label"))).toBe("4 entries across 3 days · 80% confident");
  });

  it("counts occasions for an ordered finding, not entries", () => {
    // "4 entries" would be a false description of a lag finding: each occasion
    // is a pair, so the entry count is twice the claim being made.
    expect(patternMeta(pattern("lag"))).toBe("4 times in that order · 80% confident");
  });

  it("counts occasions for a within-day ordering too", () => {
    expect(patternMeta(pattern("same-day-order"))).toBe("4 times in that order · 80% confident");
  });

  it("does not put a count next to a finding about an absence", () => {
    // The stated-vs-recorded label already carries two counts and the overlap
    // that did not happen. A meta line reading "18 entries" would look like
    // evidence for a thing that occurred eighteen times.
    expect(patternMeta(pattern("stated-vs-recorded", { occurrences: 18, distinct_days: 18 }))).toBe(
      "Something you name, and something you do · 80% confident",
    );
  });

  it("says one entry and one day in the singular", () => {
    expect(patternMeta(pattern("exact-label", { occurrences: 1, distinct_days: 1 }))).toBe(
      "1 entry across 1 day · 80% confident",
    );
  });
});

describe("where tapping a pattern goes", () => {
  it("sends an ordered finding to its occasions", () => {
    expect(patternDestination(pattern("lag"))).toEqual({
      href: "/pattern/pattern-1",
      label: "See what came first →",
    });
  });

  it("sends every other detector to the explain screen", () => {
    // A within-day ordering has no occasions endpoint of its own yet, so it
    // goes to the generic explain screen rather than a screen that cannot load.
    for (const detector of [
      "exact-label",
      "weekday",
      "stated-vs-recorded",
      "same-day-order",
    ] as const) {
      expect(patternDestination(pattern(detector))).toEqual({
        href: "/node/pattern-1",
        label: "Where this came from →",
      });
    }
  });
});
