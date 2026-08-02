import { MAX_EXTENT, RING_COUNT, type Point2, project, swell, toPath } from "./blobSphere";

const OPTIONS = { cx: 150, cy: 150, radius: 100 };

const TIMES = [-4.5, 0, 0.4, 1, 7.3, 60, 5000];

function allPoints(time = 1, extra = {}): Point2[] {
  return project(time, OPTIONS, extra).flatMap((r) => r.points);
}

function distance(p: Point2): number {
  return Math.hypot(p.x - OPTIONS.cx, p.y - OPTIONS.cy);
}

describe("project", () => {
  it("returns at least one arc per ring", () => {
    // Most rings straddle the view plane and split into a near and a far arc.
    expect(project(1, OPTIONS).length).toBeGreaterThanOrEqual(RING_COUNT);
  });

  it("accounts for every point of every ring", () => {
    // Arcs share the point where they meet, so a split ring contributes one more
    // point than its segment count — that shared point is what keeps the two
    // halves visually joined instead of leaving a gap at the silhouette edge.
    const arcs = project(1, { ...OPTIONS, segments: 24 });
    const total = arcs.reduce((sum, a) => sum + a.points.length, 0);
    const splits = arcs.length - RING_COUNT;
    expect(total).toBe(24 * RING_COUNT + splits);
  });

  it("gives no arc fewer than two points", () => {
    // A one-point arc draws nothing and is a symptom of a bad split.
    for (const arc of project(2.6, OPTIONS)) {
      expect(arc.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("sorts arcs far to near", () => {
    // Painting in this order gives correct occlusion without a depth buffer.
    const depths = project(2.2, OPTIONS).map((r) => r.depth);
    const sorted = [...depths].sort((a, b) => a - b);
    expect(depths).toEqual(sorted);
  });

  it("keeps depth within 0–1", () => {
    for (const time of TIMES) {
      for (const arc of project(time, OPTIONS)) {
        expect(arc.depth).toBeGreaterThanOrEqual(0);
        expect(arc.depth).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps a stable index per ring as arcs orbit past each other", () => {
    // Array order changes every frame as arcs cross; the palette must not, or a
    // ring would change colour halfway round its own orbit.
    const indices = new Set(project(3.7, OPTIONS).map((a) => a.index));
    expect([...indices].sort((a, b) => a - b)).toEqual([...Array(RING_COUNT).keys()]);
  });

  it("splits each ring into a near piece and a far piece", () => {
    // The contrast within one ring — far half dim, near half bright — is most of
    // what sells the volume.
    const arcs = project(1.8, OPTIONS);
    const byRing = new Map<number, number[]>();
    for (const arc of arcs) {
      byRing.set(arc.index, [...(byRing.get(arc.index) ?? []), arc.depth]);
    }
    const split = [...byRing.values()].filter((d) => d.length > 1);
    expect(split.length).toBeGreaterThan(0);
    for (const depths of split) {
      expect(Math.max(...depths)).toBeGreaterThan(0.5);
      expect(Math.min(...depths)).toBeLessThan(0.5);
    }
  });

  it("actually rotates over time", () => {
    const now = allPoints(0)[0]!;
    const later = allPoints(1.5)[0]!;
    expect(Math.hypot(now.x - later.x, now.y - later.y)).toBeGreaterThan(1);
  });

  it("is a pure function of its inputs", () => {
    // A paused sphere and a resumed one must draw the same frame.
    expect(project(4.2, OPTIONS)).toEqual(project(4.2, OPTIONS));
  });

  it("produces no NaN", () => {
    // A single NaN silently blanks the whole canvas rather than erroring.
    for (const time of TIMES) {
      for (const energy of [0, 0.5, 1]) {
        for (const p of allPoints(time, { energy })) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
        }
      }
    }
  });

  it("stays inside MAX_EXTENT so a loud syllable cannot clip", () => {
    for (const time of TIMES) {
      for (const p of allPoints(time, { energy: 1 })) {
        expect(distance(p)).toBeLessThanOrEqual(OPTIONS.radius * MAX_EXTENT + 0.01);
      }
    }
  });

  describe("perspective", () => {
    it("puts near arcs in front of far arcs", () => {
      // The whole reason this is 3D rather than a flat ring stack.
      const arcs = project(1.1, OPTIONS);
      expect(arcs[arcs.length - 1]!.depth).toBeGreaterThan(arcs[0]!.depth);
    });

    it("projects near arcs larger than far ones", () => {
      // The perspective divide showing up: the same ring is wider when its near
      // half faces the viewer.
      const arcs = project(1.1, OPTIONS);
      const reach = (a: (typeof arcs)[number]) => Math.max(...a.points.map(distance));
      const near = arcs.filter((a) => a.depth > 0.6);
      const far = arcs.filter((a) => a.depth < 0.4);
      expect(near.length).toBeGreaterThan(0);
      expect(far.length).toBeGreaterThan(0);
      expect(Math.max(...near.map(reach))).toBeGreaterThan(Math.max(...far.map(reach)));
    });

    it("does not collapse to a flat circle", () => {
      // If every point sat at the same radius, the projection would be doing
      // nothing and the sphere would read as a hoop.
      const radii = allPoints(1.9).map(distance);
      expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(
        OPTIONS.radius * 0.15,
      );
    });
  });

  describe("energy", () => {
    it("swells the whole body", () => {
      const quiet = Math.max(...allPoints(1, { energy: 0 }).map(distance));
      const loud = Math.max(...allPoints(1, { energy: 1 }).map(distance));
      expect(loud).toBeGreaterThan(quiet);
    });

    it("moves the silhouette visibly, not subtly", () => {
      // The defect this guards: energy that only wriggles the interior reads as
      // decoration rather than as something speaking.
      const quiet = Math.max(...allPoints(1, { energy: 0 }).map(distance));
      const loud = Math.max(...allPoints(1, { energy: 1 }).map(distance));
      expect(loud / quiet).toBeGreaterThan(1.1);
    });

    it("leaves the shape alone in silence", () => {
      expect(project(1, OPTIONS, { energy: 0 })).toEqual(project(1, OPTIONS));
    });

    it("clamps rather than distorting outside 0–1", () => {
      expect(project(1, OPTIONS, { energy: 5 })).toEqual(
        project(1, OPTIONS, { energy: 1 }),
      );
      expect(project(1, OPTIONS, { energy: -3 })).toEqual(
        project(1, OPTIONS, { energy: 0 }),
      );
    });

    it("keeps perspective intact while swelling", () => {
      // Applied uniformly about the centre, so a loud moment must not flatten
      // the depth cue.
      const arcs = project(1.4, OPTIONS, { energy: 1 });
      expect(arcs[arcs.length - 1]!.depth).toBeGreaterThan(arcs[0]!.depth);
    });
  });

  describe("spin", () => {
    it("holds still at zero", () => {
      // Not frozen — the rings still breathe — but the body stops turning.
      const a = project(0, OPTIONS, { spin: 0, wobble: 0 });
      const b = project(1, OPTIONS, { spin: 0, wobble: 0 });
      // Only the slow nod differs, so points stay close.
      const moved = Math.hypot(
        a[0]!.points[0]!.x - b[0]!.points[0]!.x,
        a[0]!.points[0]!.y - b[0]!.points[0]!.y,
      );
      expect(moved).toBeLessThan(OPTIONS.radius * 0.2);
    });

    it("turns further at a higher rate", () => {
      const slow = project(1, OPTIONS, { spin: 0.1 })[0]!.points[0]!;
      const fast = project(1, OPTIONS, { spin: 2 })[0]!.points[0]!;
      expect(Math.hypot(slow.x - fast.x, slow.y - fast.y)).toBeGreaterThan(1);
    });
  });
});

describe("swell", () => {
  it("scales away from the centre", () => {
    const [p] = swell([{ x: 200, y: 150 }], 150, 150, 2);
    expect(p).toEqual({ x: 250, y: 150 });
  });

  it("leaves the centre fixed", () => {
    const [p] = swell([{ x: 150, y: 150 }], 150, 150, 3);
    expect(p).toEqual({ x: 150, y: 150 });
  });

  it("is the identity at factor 1", () => {
    const points = [{ x: 10, y: 20 }];
    expect(swell(points, 0, 0, 1)).toEqual(points);
  });
});

describe("toPath", () => {
  it("produces an open path", () => {
    // An arc is half a ring. Closing it would draw a chord straight through the
    // middle of the sphere.
    const path = toPath(project(1, OPTIONS)[0]!.points);
    expect(path.startsWith("M")).toBe(true);
    expect(path).not.toMatch(/Z/);
  });

  it("emits one command per point", () => {
    const arc = project(1, OPTIONS)[0]!;
    expect(toPath(arc.points).match(/[ML]/g)).toHaveLength(arc.points.length);
  });

  it("survives an empty ring rather than emitting a broken path", () => {
    expect(toPath([])).toBe("");
  });

  it("never emits NaN", () => {
    for (const time of TIMES) {
      for (const arc of project(time, OPTIONS, { energy: 1 })) {
        expect(toPath(arc.points)).not.toMatch(/NaN/);
      }
    }
  });
});
