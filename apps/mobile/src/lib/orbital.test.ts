import {
  type Datum,
  driftFor,
  linkPairs,
  opacityFor,
  pick,
  place,
  project,
  radiusOf,
} from "./orbital";

const OPTIONS = { cx: 200, cy: 200, radius: 120 };
const TIMES = [-6.2, 0, 0.3, 1, 9.7, 400];

function data(count: number): Datum[] {
  return Array.from({ length: count }, (_, i) => ({ id: `node-${i}` }));
}

function distanceFromCentre(p: { sx: number; sy: number }): number {
  return Math.hypot(p.sx - OPTIONS.cx, p.sy - OPTIONS.cy);
}

describe("place", () => {
  it("places every datum", () => {
    expect(place(data(17))).toHaveLength(17);
  });

  it("puts everything on the unit sphere", () => {
    for (const p of place(data(40))) {
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 1);
    }
  });

  it("is deterministic", () => {
    // Open the same screen twice and your things are where you left them.
    expect(place(data(12))).toEqual(place(data(12)));
  });

  it("gives an id the same place regardless of what else is present", () => {
    // Adding an entry must not shuffle everything you had already learned the
    // position of.
    const [first] = place([{ id: "keep" }]);
    const [alsoFirst] = place([{ id: "keep" }]);
    expect(alsoFirst).toEqual(first);
  });

  it("spreads points rather than clumping them", () => {
    // Random placement clumps, and a clump reads as a meaningful cluster when it
    // means nothing at all.
    const placed = place(data(60));
    const ys = placed.map((p) => p.y).sort((a, b) => a - b);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]!);
    const biggest = Math.max(...gaps);
    // No hemisphere-sized hole anywhere in the distribution.
    expect(biggest).toBeLessThan(0.25);
  });

  it("survives a single datum", () => {
    const [only] = place([{ id: "alone" }]);
    expect(Number.isFinite(only!.x)).toBe(true);
    expect(Number.isFinite(only!.y)).toBe(true);
  });

  it("survives an empty set", () => {
    expect(place([])).toEqual([]);
  });

  it("clamps weight into range", () => {
    expect(place([{ id: "a", weight: 5 }])[0]!.weight).toBe(1);
    expect(place([{ id: "b", weight: -2 }])[0]!.weight).toBe(0);
  });

  it("carries tone and tentativeness through without interpreting them", () => {
    const [p] = place([{ id: "a", tone: "Emotion", tentative: true }]);
    expect(p!.tone).toBe("Emotion");
    expect(p!.tentative).toBe(true);
  });
});

describe("project", () => {
  const placed = place(data(30));

  it("sorts far to near", () => {
    // Painting in this order gives correct occlusion with no depth buffer.
    const depths = project(placed, 1.2, OPTIONS).map((p) => p.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });

  it("keeps depth within 0–1", () => {
    for (const time of TIMES) {
      for (const p of project(placed, time, OPTIONS)) {
        expect(p.depth).toBeGreaterThanOrEqual(0);
        expect(p.depth).toBeLessThanOrEqual(1);
      }
    }
  });

  it("draws nearer points larger", () => {
    // The perspective divide showing up. Without this it is a flat ring of dots.
    const projected = project(placed, 0.7, OPTIONS);
    const near = projected[projected.length - 1]!;
    const far = projected[0]!;
    expect(near.scale).toBeGreaterThan(far.scale);
  });

  it("rotates over time", () => {
    const a = project(placed, 0, OPTIONS)[0]!;
    const b = project(placed, 3, OPTIONS).find((p) => p.id === a.id)!;
    expect(Math.hypot(a.sx - b.sx, a.sy - b.sy)).toBeGreaterThan(1);
  });

  it("answers to drag", () => {
    const still = project(placed, 1, OPTIONS, { spin: 0 });
    const dragged = project(placed, 1, OPTIONS, { spin: 0, drag: 1.2 });
    const a = still[0]!;
    const b = dragged.find((p) => p.id === a.id)!;
    expect(Math.hypot(a.sx - b.sx, a.sy - b.sy)).toBeGreaterThan(1);
  });

  it("holds still when neither spinning nor dragged", () => {
    expect(project(placed, 0, OPTIONS, { spin: 0 })).toEqual(
      project(placed, 40, OPTIONS, { spin: 0 }),
    );
  });

  it("produces no NaN", () => {
    // A single NaN silently blanks a canvas rather than erroring.
    for (const time of TIMES) {
      for (const p of project(placed, time, OPTIONS)) {
        expect(Number.isFinite(p.sx)).toBe(true);
        expect(Number.isFinite(p.sy)).toBe(true);
      }
    }
  });

  it("stays near the intended radius", () => {
    // Perspective widens the near face, but nothing should fly off-canvas where
    // it cannot be tapped.
    for (const p of project(placed, 2.4, OPTIONS)) {
      expect(distanceFromCentre(p)).toBeLessThan(OPTIONS.radius * 1.5);
    }
  });

  it("is a pure function of its inputs", () => {
    expect(project(placed, 2.2, OPTIONS)).toEqual(project(placed, 2.2, OPTIONS));
  });

  it("survives an empty scene", () => {
    expect(project([], 1, OPTIONS)).toEqual([]);
  });
});

describe("radiusOf", () => {
  const projected = project(place(data(20)), 1, OPTIONS);

  it("grows with weight", () => {
    const light = { ...projected[0]!, weight: 0.1, depth: 0.5 };
    const heavy = { ...projected[0]!, weight: 1, depth: 0.5 };
    expect(radiusOf(heavy, 10)).toBeGreaterThan(radiusOf(light, 10));
  });

  it("lets weight outrank depth", () => {
    // A heavy point at the back must still read as heavier than a light one at
    // the front, or the screen reports rotation instead of data.
    const heavyFar = { ...projected[0]!, weight: 1, depth: 0 };
    const lightNear = { ...projected[0]!, weight: 0.1, depth: 1 };
    expect(radiusOf(heavyFar, 10)).toBeGreaterThan(radiusOf(lightNear, 10));
  });

  it("is always positive", () => {
    for (const p of projected) {
      expect(radiusOf(p, 8)).toBeGreaterThan(0);
    }
  });
});

describe("pick", () => {
  const projected = project(place(data(24)), 1, OPTIONS);

  it("finds the point under the tap", () => {
    const target = projected[5]!;
    expect(pick(projected, target.sx, target.sy, 24)?.id).toBe(target.id);
  });

  it("returns nothing when the tap is empty space", () => {
    // Tapping nowhere must clear, so there is always a way out of a selection.
    expect(pick(projected, -500, -500, 24)).toBeNull();
  });

  it("respects the tolerance", () => {
    const target = projected[3]!;
    expect(pick(projected, target.sx + 60, target.sy, 10)).toBeNull();
  });

  it("prefers the nearer of two overlapping points", () => {
    // Picking the one you cannot see is the kind of bug that makes an interface
    // feel haunted.
    const far = { ...projected[0]!, id: "far", sx: 100, sy: 100, depth: 0 };
    const near = { ...projected[0]!, id: "near", sx: 100, sy: 100, depth: 1 };
    expect(pick([far, near], 100, 100, 20)?.id).toBe("near");
  });

  it("still prefers distance over depth", () => {
    // A far point directly under the finger beats a near one an inch away.
    const under = { ...projected[0]!, id: "under", sx: 100, sy: 100, depth: 0 };
    const away = { ...projected[0]!, id: "away", sx: 118, sy: 100, depth: 1 };
    expect(pick([under, away], 100, 100, 20)?.id).toBe("under");
  });

  it("survives an empty scene", () => {
    expect(pick([], 10, 10, 20)).toBeNull();
  });
});

describe("linkPairs", () => {
  const projected = project(place(data(6)), 1, OPTIONS);

  it("resolves endpoints", () => {
    const pairs = linkPairs(projected, [{ from: "node-0", to: "node-3" }]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.from.id).toBe("node-0");
  });

  it("drops links to points that are not in the scene", () => {
    // The API prunes these, but a client should not fall over if one slips past.
    expect(linkPairs(projected, [{ from: "node-0", to: "ghost" }])).toEqual([]);
  });

  it("sorts far to near like the points do", () => {
    const pairs = linkPairs(projected, [
      { from: "node-0", to: "node-1" },
      { from: "node-2", to: "node-4" },
      { from: "node-1", to: "node-5" },
    ]);
    const depths = pairs.map((p) => p.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });

  it("survives having no links", () => {
    expect(linkPairs(projected, [])).toEqual([]);
  });
});

describe("judgement changes where a point sits", () => {
  it("pushes a rejected reading outward", () => {
    // The consequence of disagreeing should be something you watch happen, not
    // something you are told about.
    expect(driftFor("user_rejected")).toBeGreaterThan(1);
  });

  it("pulls a confirmed reading inward", () => {
    // So the things you have actually agreed with form a core.
    expect(driftFor("user_confirmed")).toBeLessThan(1);
  });

  it("leaves an unexamined reading where it is", () => {
    expect(driftFor("hypothesis")).toBe(1);
    expect(driftFor(null)).toBe(1);
    expect(driftFor(undefined)).toBe(1);
  });

  it("keeps a rejected reading visible rather than removing it", () => {
    // The system did think this. Deleting the evidence would make it impossible
    // to notice it keeps making the same mistake.
    expect(opacityFor("user_rejected")).toBeGreaterThan(0);
  });

  it("dims a rejected reading below everything current", () => {
    expect(opacityFor("user_rejected")).toBeLessThan(opacityFor("hypothesis"));
    expect(opacityFor("user_rejected")).toBeLessThan(opacityFor("user_confirmed"));
  });

  it("shows a confirmed reading most strongly", () => {
    expect(opacityFor("user_confirmed")).toBeGreaterThanOrEqual(opacityFor("hypothesis"));
  });

  it("treats an unknown status as unexamined", () => {
    // A new epistemic status should look ordinary, not invisible.
    expect(driftFor("something_new")).toBe(1);
    expect(opacityFor("something_new")).toBe(opacityFor("hypothesis"));
  });
});
