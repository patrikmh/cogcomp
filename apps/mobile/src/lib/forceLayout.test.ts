import {
  SETTLED_THRESHOLD,
  type LayoutEdge,
  clampToBounds,
  initialiseNodes,
  nodeAt,
  settle,
  step,
} from "./forceLayout";

const OPTIONS = { width: 400, height: 600 };

function nodes(count: number, kind = "Thought") {
  return Array.from({ length: count }, (_, i) => ({ id: `n${i}`, kind }));
}

describe("initialiseNodes", () => {
  it("places every node", () => {
    expect(initialiseNodes(nodes(5), OPTIONS)).toHaveLength(5);
  });

  it("is deterministic", () => {
    // The point of seeding from ids: the same graph settles the same way every
    // time, so spatial memory of where things are actually works.
    const a = initialiseNodes(nodes(6), OPTIONS);
    const b = initialiseNodes(nodes(6), OPTIONS);
    expect(a.map((n) => [n.x, n.y])).toEqual(b.map((n) => [n.x, n.y]));
  });

  it("gives different ids different positions", () => {
    const placed = initialiseNodes(nodes(8), OPTIONS);
    const positions = new Set(placed.map((n) => `${n.x},${n.y}`));
    expect(positions.size).toBe(8);
  });

  it("does not start everything in one spot", () => {
    // A blob start makes the first frames a violent explosion as repulsion resolves.
    const placed = initialiseNodes(nodes(10), OPTIONS);
    const xs = placed.map((n) => n.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(50);
  });

  it("marks observations", () => {
    const placed = initialiseNodes(
      [
        { id: "o1", kind: "Observation" },
        { id: "t1", kind: "Thought" },
      ],
      OPTIONS,
    );
    expect(placed[0]!.isObservation).toBe(true);
    expect(placed[1]!.isObservation).toBe(false);
  });

  it("handles an empty graph", () => {
    expect(initialiseNodes([], OPTIONS)).toEqual([]);
  });

  it("handles a single node without dividing by zero", () => {
    const placed = initialiseNodes(nodes(1), OPTIONS);
    expect(Number.isFinite(placed[0]!.x)).toBe(true);
    expect(Number.isFinite(placed[0]!.y)).toBe(true);
  });
});

describe("step", () => {
  it("pushes nodes apart when they are close", () => {
    // Repulsion dominates at short range. It does not dominate globally —
    // centering legitimately wins at long range, which is what stops a sparse
    // graph from drifting apart forever — so this starts them close.
    const placed = initialiseNodes(nodes(2), OPTIONS);
    placed[0]!.x = 200;
    placed[0]!.y = 300;
    placed[1]!.x = 215;
    placed[1]!.y = 300;

    const before = Math.hypot(
      placed[0]!.x - placed[1]!.x,
      placed[0]!.y - placed[1]!.y,
    );
    for (let i = 0; i < 20; i++) step(placed, [], OPTIONS);
    const after = Math.hypot(
      placed[0]!.x - placed[1]!.x,
      placed[0]!.y - placed[1]!.y,
    );
    expect(after).toBeGreaterThan(before);
  });

  it("settles a sparse graph rather than letting it drift apart forever", () => {
    // The other half of the same trade-off: centering has to win eventually.
    const placed = initialiseNodes(nodes(3), OPTIONS);
    settle(placed, [], OPTIONS);
    const spread = Math.max(...placed.map((n) => Math.hypot(n.x - 200, n.y - 300)));
    expect(spread).toBeLessThan(400);
  });

  it("pulls connected nodes closer than unconnected ones", () => {
    const placed = initialiseNodes(nodes(4), OPTIONS);
    const edges: LayoutEdge[] = [{ from: "n0", to: "n1" }];
    settle(placed, edges, OPTIONS);

    const byId = new Map(placed.map((n) => [n.id, n]));
    const connected = Math.hypot(
      byId.get("n0")!.x - byId.get("n1")!.x,
      byId.get("n0")!.y - byId.get("n1")!.y,
    );
    const unconnected = Math.hypot(
      byId.get("n2")!.x - byId.get("n3")!.x,
      byId.get("n2")!.y - byId.get("n3")!.y,
    );
    expect(connected).toBeLessThan(unconnected);
  });

  it("never produces NaN, even from coincident nodes", () => {
    // Two nodes at the same point have no direction to separate along; the
    // fallback has to be finite or the whole canvas goes blank.
    const placed = initialiseNodes(nodes(2), OPTIONS);
    placed[1]!.x = placed[0]!.x;
    placed[1]!.y = placed[0]!.y;

    for (let i = 0; i < 30; i++) step(placed, [], OPTIONS);
    for (const node of placed) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it("separates coincident nodes deterministically", () => {
    const run = () => {
      const placed = initialiseNodes(nodes(2), OPTIONS);
      placed[1]!.x = placed[0]!.x;
      placed[1]!.y = placed[0]!.y;
      for (let i = 0; i < 10; i++) step(placed, [], OPTIONS);
      return placed.map((n) => [n.x, n.y]);
    };
    expect(run()).toEqual(run());
  });

  it("ignores edges pointing at nodes it was not given", () => {
    // The API prunes these, but the client should not crash if one slips through.
    const placed = initialiseNodes(nodes(2), OPTIONS);
    expect(() =>
      step(placed, [{ from: "n0", to: "ghost" }], OPTIONS),
    ).not.toThrow();
    expect(Number.isFinite(placed[0]!.x)).toBe(true);
  });

  it("clamps velocity so nothing is ejected off-canvas", () => {
    const placed = initialiseNodes(nodes(2), OPTIONS);
    placed[0]!.vx = 100000;
    step(placed, [], OPTIONS);
    expect(Math.abs(placed[0]!.vx)).toBeLessThanOrEqual(31);
  });

  it("reports decreasing movement as it settles", () => {
    const placed = initialiseNodes(nodes(6), OPTIONS);
    const first = step(placed, [], OPTIONS);
    for (let i = 0; i < 100; i++) step(placed, [], OPTIONS);
    const later = step(placed, [], OPTIONS);
    expect(later).toBeLessThan(first);
  });
});

describe("settle", () => {
  it("converges below the settled threshold", () => {
    const placed = initialiseNodes(nodes(8), OPTIONS);
    settle(placed, [{ from: "n0", to: "n1" }], OPTIONS);
    expect(step(placed, [{ from: "n0", to: "n1" }], OPTIONS)).toBeLessThan(
      SETTLED_THRESHOLD * 4,
    );
  });

  it("is bounded, so a pathological graph cannot hang the UI", () => {
    const placed = initialiseNodes(nodes(40), OPTIONS);
    const edges = placed.flatMap((n, i) =>
      placed.slice(i + 1).map((m) => ({ from: n.id, to: m.id })),
    );
    const started = Date.now();
    settle(placed, edges, OPTIONS, 50);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("leaves every node on screen", () => {
    // A node outside the canvas is a node the person cannot tap, so settling
    // clamps the few outliers repulsion pushes past the edge.
    const placed = initialiseNodes(nodes(30), OPTIONS);
    settle(placed, [], OPTIONS);
    for (const node of placed) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(OPTIONS.width);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(OPTIONS.height);
    }
  });

  it("clamps a node that escaped far off-canvas", () => {
    const placed = initialiseNodes(nodes(2), OPTIONS);
    placed[0]!.x = 99999;
    placed[0]!.y = -99999;
    clampToBounds(placed, OPTIONS);
    expect(placed[0]!.x).toBeLessThanOrEqual(OPTIONS.width);
    expect(placed[0]!.y).toBeGreaterThanOrEqual(0);
  });

  it("produces the same layout for the same graph", () => {
    const edges = [{ from: "n0", to: "n1" }, { from: "n1", to: "n2" }];
    const run = () => settle(initialiseNodes(nodes(5), OPTIONS), edges, OPTIONS)
      .map((n) => [Math.round(n.x), Math.round(n.y)]);
    expect(run()).toEqual(run());
  });
});

describe("nodeAt", () => {
  it("finds a node under the point", () => {
    const placed = initialiseNodes(nodes(3), OPTIONS);
    const target = placed[1]!;
    expect(nodeAt(placed, target.x + 2, target.y + 2, 20)?.id).toBe(target.id);
  });

  it("returns null when nothing is close enough", () => {
    const placed = initialiseNodes(nodes(3), OPTIONS);
    expect(nodeAt(placed, 100000, 100000, 20)).toBeNull();
  });

  it("returns the nearest when circles overlap", () => {
    // Otherwise a tap opens whichever node happened to be first in the array,
    // which looks random to the person tapping.
    const placed = initialiseNodes(nodes(2), OPTIONS);
    placed[0]!.x = 100;
    placed[0]!.y = 100;
    placed[1]!.x = 110;
    placed[1]!.y = 100;
    expect(nodeAt(placed, 109, 100, 30)?.id).toBe(placed[1]!.id);
  });

  it("handles an empty graph", () => {
    expect(nodeAt([], 0, 0, 20)).toBeNull();
  });
});
