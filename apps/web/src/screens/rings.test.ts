import { describe, expect, it } from "vitest";

import { type IdentityNode } from "@/lib/api";
import { ringsFor } from "./Identity";

/**
 * Which readings the identity composition draws.
 *
 * The screen is headed "Drawn from everything you kept", and it used to sort
 * kept and offered readings together by confidence and cut at seven. On a real
 * account that meant thirty-nine offered readings outranked the single reading
 * the person had confirmed, so the picture was seven mundane activities and
 * none of what they kept. Extraction is surest about the most literal things,
 * so confidence alone is the wrong order for this picture.
 */
const node = (over: Partial<IdentityNode> & { id: string }): IdentityNode =>
  ({
    kind: "Activity",
    label: over.id,
    confidence: 0.9,
    tentative: false,
    status: "candidate",
    ...over,
  }) as IdentityNode;

const kept = (id: string, confidence: number, over: Partial<IdentityNode> = {}) =>
  node({ id, confidence, status: "selected", ...over });

const offered = (id: string, confidence: number) => node({ id, confidence });

describe("ringsFor", () => {
  it("draws what was kept even when everything offered outranks it", () => {
    const many = Array.from({ length: 39 }, (_, i) => offered(`offered-${i}`, 0.95));
    const rings = ringsFor([kept("the-one", 0.45)], many, []);

    expect(rings.map((r) => r.id)).toContain("the-one");
  });

  it("puts what was kept closest to the core", () => {
    const rings = ringsFor([kept("mine", 0.4)], [offered("theirs", 0.99)], []);

    expect(rings.map((r) => r.id)).toEqual(["mine", "theirs"]);
  });

  it("still orders surest-first inside each group", () => {
    const rings = ringsFor(
      [kept("low", 0.3), kept("high", 0.8)],
      [offered("b", 0.5), offered("a", 0.7)],
      [],
    );

    expect(rings.map((r) => r.id)).toEqual(["high", "low", "a", "b"]);
  });

  it("draws no more than seven, plus one tombstone", () => {
    const many = Array.from({ length: 20 }, (_, i) => offered(`o-${i}`, 0.5));
    const rings = ringsFor([], many, [node({ id: "gone", status: "removed" })]);

    expect(rings).toHaveLength(8);
    expect(rings.filter((r) => r.removed)).toHaveLength(1);
  });

  it("marks a kept-but-tentative reading as both", () => {
    const rings = ringsFor([kept("t", 0.45, { tentative: true })], [], []);

    expect(rings.map((r) => [r.kept, r.tentative])).toEqual([[true, true]]);
  });

  it("says of each ring whether it was kept or merely offered", () => {
    const rings = ringsFor([kept("mine", 0.4, { kind: "Need" })], [offered("theirs", 0.3)], []);

    expect(rings.map((r) => r.evidence)).toEqual(["need · kept", "activity · offered"]);
  });

  it("keeps a removal visible, so it can be reconsidered", () => {
    const rings = ringsFor([], [], [node({ id: "gone", status: "removed" })]);

    expect(rings.map((r) => [r.removed, r.evidence])).toEqual([[true, "removed · reversible"]]);
  });
});
