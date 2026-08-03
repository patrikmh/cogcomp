import {
  flowArcPaths,
  headClipPath,
  headPath,
  neuralTracePaths,
  skullCentre,
} from "./headSilhouette";

const SIZE = 300;

type Point = { x: number; y: number };
type Cubic = { start: Point; c1: Point; c2: Point; end: Point };

function coordinates(path: string): Point[] {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const points: Point[] = [];
  for (let i = 0; i < numbers.length; i += 2) {
    points.push({ x: numbers[i]!, y: numbers[i + 1]! });
  }
  return points;
}

function cubicSegments(path: string): Cubic[] {
  const points = coordinates(path);
  return Array.from({ length: (points.length - 1) / 3 }, (_, index) => {
    const start = points[index * 3]!;
    return {
      start,
      c1: points[index * 3 + 1]!,
      c2: points[index * 3 + 2]!,
      end: points[index * 3 + 3]!,
    };
  });
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function tangentContinuity(first: Cubic, second: Cubic): number {
  const outgoing = { x: first.end.x - first.c2.x, y: first.end.y - first.c2.y };
  const incoming = { x: second.c1.x - second.start.x, y: second.c1.y - second.start.y };
  return (
    (outgoing.x * incoming.x + outgoing.y * incoming.y) /
    (Math.hypot(outgoing.x, outgoing.y) * Math.hypot(incoming.x, incoming.y))
  );
}

function chordDeviation(segment: Cubic): number {
  const chord = { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y };
  const handle = { x: segment.c1.x - segment.start.x, y: segment.c1.y - segment.start.y };
  return Math.abs(chord.x * handle.y - chord.y * handle.x) / Math.hypot(chord.x, chord.y);
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

  it("uses the simple ten-segment reference outline", () => {
    const points = coordinates(headPath({ size: 100, inset: 1 }));
    const endpoints = [0, ...Array.from({ length: 10 }, (_, index) => 3 * (index + 1))].map(
      (index) => points[index]!,
    );
    const landmarks = [
      [0.30, 1.00],
      [0.31, 0.72],
      [0.12, 0.45],
      [0.40, 0.07],
      [0.74, 0.22],
      [0.74, 0.43],
      [0.85, 0.57],
      [0.79, 0.63],
      [0.77, 0.73],
      [0.60, 0.82],
      [0.43, 1.00],
    ];

    expect((headPath({ size: 100, inset: 1 }).match(/C/g) ?? [])).toHaveLength(10);
    landmarks.forEach(([x, y], index) => {
      expect(endpoints[index]!.x).toBeCloseTo(x! * 100, 5);
      expect(endpoints[index]!.y).toBeCloseTo(y! * 100, 5);
    });
    expect(endpoints[0]!.y).toBe(100);
    expect(endpoints.at(-1)!.y).toBe(100);
    expect(endpoints[2]!.y).toBeGreaterThan(endpoints[3]!.y);
    expect(endpoints[3]!.x).toBeGreaterThan(endpoints[2]!.x);

    const rightmost = points.reduce((a, b) => (b.x > a.x ? b : a));
    expect(rightmost).toEqual(endpoints[6]);
  });

  it("preserves smooth curvature at the key profile transitions", () => {
    const segments = cubicSegments(headPath({ size: 100, inset: 1 }));
    const rear = segments[1]!;
    const crown = segments[2]!;
    const forehead = segments[3]!;
    const jaw = segments[8]!;
    const neck = segments[9]!;

    // Handles must describe actual rounded turns, rather than merely naming
    // the endpoints of an otherwise angular polyline.
    for (const segment of [rear, crown, forehead, jaw, neck]) {
      expect(distance(segment.start, segment.c1)).toBeGreaterThan(2);
      expect(distance(segment.c2, segment.end)).toBeGreaterThan(2);
      expect(chordDeviation(segment)).toBeGreaterThan(1);
    }

    // The rear/crown, crown/forehead, and jaw/neck joins should carry a single
    // tangent through the join instead of making a visible corner.
    for (const [first, second] of [
      [rear, crown],
      [crown, forehead],
      [jaw, neck],
    ] as const) {
      expect(tangentContinuity(first, second)).toBeGreaterThan(0.94);
    }
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

  it("keeps finite normalised geometry at every supported inset", () => {
    for (const inset of [0.5, 0.92, 1]) {
      const path = headPath({ size: SIZE, inset });
      expect(path).not.toMatch(/NaN|Infinity/);
      for (const point of coordinates(path)) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(SIZE);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(SIZE);
      }
    }
  });

  it("applies inset symmetrically and scales linearly", () => {
    const full = coordinates(headPath({ size: 100, inset: 1 }));
    const inset = coordinates(headPath({ size: 200, inset: 0.5 }));
    expect(inset[0]!.x).toBeCloseTo(50 + full[0]!.x, 1);
    expect(inset[0]!.y).toBeCloseTo(50 + full[0]!.y, 1);
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

describe("neural profile geometry", () => {
  it.each([
    ["flow arcs", 3, flowArcPaths],
    ["neural traces", 4, neuralTracePaths],
  ] as const)("%s has exactly %i paths", (_name, count, paths) => {
    expect(paths({ size: SIZE })).toHaveLength(count);
  });

  it.each([
    ["flow arcs", flowArcPaths],
    ["neural traces", neuralTracePaths],
  ] as const)("uses open cubic-only paths for %s", (_name, paths) => {
    for (const path of paths({ size: SIZE })) {
      expect(path).toMatch(/^M\d+(?:\.\d+)? \d+(?:\.\d+)? C/);
      expect(path).not.toMatch(/[LlHhVvZzQqSsTtAa]/);
      expect((path.match(/C/g) ?? [])).toHaveLength(1);
      expect(path.trim().endsWith("Z")).toBe(false);
    }
  });

  it.each([
    ["flow arcs", flowArcPaths],
    ["neural traces", neuralTracePaths],
  ] as const)("stays finite, in bounds, and out of the face for %s", (_name, paths) => {
    for (const path of paths({ size: SIZE })) {
      expect(path).not.toMatch(/NaN|Infinity/);
      for (const point of coordinates(path)) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(SIZE);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(SIZE);
        expect(point.x).toBeLessThanOrEqual(SIZE * 0.7);
      }
    }
  });

  it("is deterministic and uses the shared scale and inset", () => {
    expect(flowArcPaths({ size: SIZE })).toEqual(flowArcPaths({ size: SIZE }));
    expect(neuralTracePaths({ size: SIZE })).toEqual(neuralTracePaths({ size: SIZE }));
    const normal = coordinates(flowArcPaths({ size: 100, inset: 1 })[0]!);
    const scaled = coordinates(flowArcPaths({ size: 200, inset: 0.5 })[0]!);
    expect(scaled[0]!.x).toBeCloseTo(50 + normal[0]!.x, 1);
    expect(scaled[0]!.y).toBeCloseTo(50 + normal[0]!.y, 1);
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
