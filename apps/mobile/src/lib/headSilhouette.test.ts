import { headClipPath, headPath, skullCentre } from "./headSilhouette";

const SIZE = 300;

function coordinates(path: string): { x: number; y: number }[] {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const points = [];
  for (let i = 0; i < numbers.length; i += 2) {
    points.push({ x: numbers[i]!, y: numbers[i + 1]! });
  }
  return points;
}

describe("headPath", () => {
  it("starts with a move", () => {
    expect(headPath({ size: SIZE }).startsWith("M")).toBe(true);
  });

  it("is drawn in curves, not straight lines", () => {
    // A head drawn with line segments reads as a logo. This has to read as a
    // person, which means every segment is cubic.
    const path = headPath({ size: SIZE });
    expect(path).toMatch(/C/);
    expect(path).not.toMatch(/[LlHhVv]/);
  });

  it("stays inside its box", () => {
    // Callers size a square canvas from this; a control point outside the box
    // would clip against the canvas edge instead of drawing a jaw.
    for (const p of coordinates(headPath({ size: SIZE }))) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(SIZE);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(SIZE);
    }
  });

  it("scales with size", () => {
    const small = coordinates(headPath({ size: 100 }));
    const large = coordinates(headPath({ size: 200 }));
    expect(large[0]!.x).toBeCloseTo(small[0]!.x * 2, 1);
  });

  it("produces no NaN", () => {
    // A single NaN silently blanks a Skia canvas rather than erroring.
    for (const size of [1, 40, 300, 4000]) {
      expect(headPath({ size })).not.toMatch(/NaN/);
    }
  });

  it("faces right", () => {
    // The face is on the right-hand side, so the rightmost point — the nose —
    // must sit in the upper half, not down in the jaw.
    const points = coordinates(headPath({ size: SIZE }));
    const nose = points.reduce((a, b) => (b.x > a.x ? b : a));
    expect(nose.y).toBeLessThan(SIZE * 0.7);
    expect(nose.y).toBeGreaterThan(SIZE * 0.4);
  });

  it("is open at the neck", () => {
    // Closing it would make a balloon. The neck runs off the bottom edge.
    expect(headPath({ size: SIZE })).not.toMatch(/Z/);
  });

  it("is deterministic", () => {
    expect(headPath({ size: SIZE })).toBe(headPath({ size: SIZE }));
  });
});

describe("headClipPath", () => {
  it("closes the outline so it can bound a region", () => {
    expect(headClipPath({ size: SIZE }).endsWith("Z")).toBe(true);
  });

  it("is the outline plus the close", () => {
    expect(headClipPath({ size: SIZE })).toBe(`${headPath({ size: SIZE })} Z`);
  });
});

describe("skullCentre", () => {
  it("sits above the middle of the box", () => {
    // A profile is mostly jaw and neck below the midpoint, so a constellation
    // centred on the box would hang out through the chin.
    const { cy } = skullCentre({ size: SIZE });
    expect(cy).toBeLessThan(SIZE / 2);
  });

  it("keeps the constellation inside the cranium", () => {
    const { cx, cy, radius } = skullCentre({ size: SIZE });
    expect(cx - radius).toBeGreaterThan(0);
    expect(cy - radius).toBeGreaterThan(0);
    expect(cx + radius).toBeLessThan(SIZE);
    // The whole sphere has to clear the brow line, or points orbit through the
    // face. Checked against the perspective-widened radius, since that is what
    // actually gets drawn — the near face is about a third larger than the
    // nominal sphere.
    expect(cy + radius * 1.34).toBeLessThan(SIZE * 0.72);
  });

  it("scales with size", () => {
    const small = skullCentre({ size: 100 });
    const large = skullCentre({ size: 200 });
    expect(large.radius).toBeCloseTo(small.radius * 2, 5);
  });
});
