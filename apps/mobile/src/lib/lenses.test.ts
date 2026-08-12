import { LENSES, lensesFor, resolveLens } from "./lenses";

describe("which lenses are offered", () => {
  it("offers all four when findings are on", () => {
    // Four, as the design has them. Regions was a fifth here until it moved to
    // Patterns, where a region sits beside the recurrences it is a cousin of.
    expect(lensesFor(true).map((lens) => lens.id)).toEqual([
      "today",
      "all",
      "patterns",
      "changed",
    ]);
  });

  it("keeps only what the person wrote when findings are off", () => {
    // Today and Everything are the record. The other two are conclusions drawn
    // across time, and those are what someone switches off.
    expect(lensesFor(false).map((lens) => lens.id)).toEqual(["today", "all"]);
  });

  it("never leaves someone with nothing to look at", () => {
    expect(lensesFor(false).length).toBeGreaterThan(0);
  });

  it("orders lenses by distance from the words themselves", () => {
    // A day is a fact, the graph is a record, a recurrence is a claim, a change
    // is a comparison between two windows. The row makes that distance visible,
    // so the order is part of the argument rather than a layout detail.
    expect(LENSES.map((lens) => lens.finding)).toEqual([false, false, true, true]);
  });
});

describe("landing on a lens that exists", () => {
  it("keeps the chosen lens when it is still available", () => {
    expect(resolveLens("patterns", true)).toBe("patterns");
    expect(resolveLens("all", false)).toBe("all");
  });

  it("falls back to today when the chosen lens was switched off", () => {
    // Turning findings off while looking at Recurring must not leave someone
    // staring at a lens that no longer exists.
    for (const lens of ["patterns", "changed"] as const) {
      expect(resolveLens(lens, false)).toBe("today");
    }
  });
});
