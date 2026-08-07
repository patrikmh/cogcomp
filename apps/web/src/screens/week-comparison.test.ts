import { describe, expect, it } from "vitest";

import { comparisonName } from "./Week";

/**
 * What the week beside this one is called.
 *
 * The screen states a true number under this label — "2 fewer than last week" —
 * so the label has to be true as well. It said "this week" for every past week,
 * which meant that two weeks back the screen compared against a week that was
 * neither the one on screen nor the current one, and named it wrongly. A true
 * number under a false label is worse than no comparison at all: it is the kind
 * of thing a person would believe.
 */
describe("comparisonName", () => {
  it("compares the current week with the one before it", () => {
    expect(comparisonName(0)).toBe("last week");
  });

  it("compares last week with the current one", () => {
    expect(comparisonName(1)).toBe("this week");
  });

  it("does not call some earlier week 'this week'", () => {
    // Two back, the neighbour is the week after the one on screen — which is
    // still in the past, and calling it "this week" was the bug.
    expect(comparisonName(2)).not.toBe("this week");
    expect(comparisonName(2)).toBe("the week after");
  });

  it("stays honest however far back you go", () => {
    for (let back = 2; back < 30; back++) {
      expect(comparisonName(back)).toBe("the week after");
    }
  });
});
