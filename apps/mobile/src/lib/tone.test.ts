import { toneFor } from "@tlon/design";

/**
 * Colour marks what is known, never what kind of thing it is.
 *
 * The mobile client gave each of eleven node kinds its own colour, which made
 * Thought and Emotion distinguishable at a glance and confident and doubtful
 * indistinguishable — the wrong way round for an app whose argument is that you
 * can see how sure it is.
 */
describe("toneFor", () => {
  it("gives every kind the same colour when the record stands behind it", () => {
    const kinds = ["Thought", "Emotion", "Need", "Value", "Belief", "Person", "Place", "Activity"];
    const tones = new Set(kinds.map((kind) => toneFor({ kind })));
    expect(tones.size).toBe(1);
  });

  it("distinguishes a tentative reading from a confident one", () => {
    expect(toneFor({ kind: "Need", tentative: true })).not.toBe(toneFor({ kind: "Need" }));
  });

  it("fades a reading that was taken back", () => {
    expect(toneFor({ kind: "Need", removed: true })).not.toBe(toneFor({ kind: "Need" }));
  });

  it("sets an act apart, because it makes no claim at all", () => {
    expect(toneFor({ kind: "Observation" })).not.toBe(toneFor({ kind: "Thought" }));
  });

  it("treats removal as louder than doubt", () => {
    expect(toneFor({ removed: true, tentative: true })).toBe(toneFor({ removed: true }));
  });
});
