import { describe, expect, it } from "vitest";

import { loopsOf } from "./IdentityComposition";

/**
 * How many loops each ring in the identity composition is drawn with.
 *
 * The design's rule is `gone || tentative ? 1 : 2` — detail stands for how sure
 * the reading is. This app gave the second loop only to readings the person had
 * kept, so a confidently offered one was drawn as faintly as a doubtful one,
 * and the picture said "you have not answered this yet" using the mark that
 * means "the record is unsure".
 */
describe("loopsOf", () => {
  it("draws a confident reading with two loops whether or not it was kept", () => {
    expect(loopsOf({ tentative: false, removed: false })).toHaveLength(2);
  });

  it("draws a tentative reading with one", () => {
    expect(loopsOf({ tentative: true, removed: false })).toHaveLength(1);
  });

  it("draws a removed reading with one", () => {
    expect(loopsOf({ tentative: false, removed: true })).toHaveLength(1);
  });

  it("treats a tentative reading that was also removed as removed", () => {
    expect(loopsOf({ tentative: true, removed: true })).toHaveLength(1);
  });
});
