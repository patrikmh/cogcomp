import { describe, expect, it } from "vitest";

import type { TemporalChange } from "./api";
import { normaliseLabel, shiftsForSubjects } from "./patterns";

function change(label: string, shift: TemporalChange["shift"] = "more"): TemporalChange {
  return {
    kind: "Emotion",
    label,
    shift,
    recent_days: 4,
    earlier_days: 1,
    confidence: 0.8,
    description: `came up on 4 of the last 7 days, and on 1 of the 7 before`,
  };
}

const SUBJECTS = ["dread", "broken sleep"];

describe("normaliseLabel", () => {
  it("folds case and punctuation, the way the backend folds them", () => {
    expect(normaliseLabel("  Drained. ")).toBe("drained");
    expect(normaliseLabel("Tired,")).toBe("tired");
  });

  it("keeps real word differences apart", () => {
    expect(normaliseLabel("drained")).not.toBe(normaliseLabel("hollowed out"));
  });
});

describe("shiftsForSubjects", () => {
  it("matches a shift whose label equals a thread subject", () => {
    const found = shiftsForSubjects([change("dread")], SUBJECTS);
    expect(found).toHaveLength(1);
    expect(found[0]?.label).toBe("dread");
  });

  it("ignores shifts about anything else", () => {
    expect(shiftsForSubjects([change("running")], SUBJECTS)).toEqual([]);
  });

  it("matches through trivial punctuation and case only", () => {
    const found = shiftsForSubjects([change(" Dread. ")], SUBJECTS);
    expect(found).toHaveLength(1);
  });

  it("never invents a match from a partial word", () => {
    // "dreadful" is not "dread" — a substring match would invent a
    // relationship between two different words.
    expect(shiftsForSubjects([change("dreadful")], SUBJECTS)).toEqual([]);
  });

  it("returns nothing without subjects or changes", () => {
    expect(shiftsForSubjects([], SUBJECTS)).toEqual([]);
    expect(shiftsForSubjects([change("dread")], [])).toEqual([]);
  });
});
