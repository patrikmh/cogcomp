import { describe, expect, it } from "vitest";

import { headspaceCount, readingsOn } from "./Headspace";

/**
 * What the map holds.
 *
 * The rail says this number beside "Headspace", and the map builds what it
 * draws from the same two functions. If they ever disagree, the rail is lying
 * about a screen one click away — so the rule lives here rather than in each.
 */
const node = (id: string, kind: string) => ({ id, kind });

describe("readingsOn", () => {
  it("leaves out observations, which are acts rather than readings", () => {
    const nodes = [node("a", "Observation"), node("b", "Value")];
    expect(readingsOn(nodes, new Set()).map((n) => n.id)).toEqual(["b"]);
  });

  it("leaves out patterns, which the map places from their own source", () => {
    const nodes = [node("a", "Pattern"), node("b", "Need")];
    expect(readingsOn(nodes, new Set()).map((n) => n.id)).toEqual(["b"]);
  });

  it("leaves out anything already drawn as today", () => {
    const nodes = [node("a", "Value"), node("b", "Value")];
    expect(readingsOn(nodes, new Set(["a"])).map((n) => n.id)).toEqual(["b"]);
  });

  it("caps what it places, so the map cannot become a fog", () => {
    const nodes = Array.from({ length: 60 }, (_, i) => node(`n${i}`, "Value"));
    expect(readingsOn(nodes, new Set())).toHaveLength(26);
  });
});

describe("headspaceCount", () => {
  it("counts you, the patterns, today, and the readings placed", () => {
    const patterns = [{ id: "p1" }, { id: "p2" }];
    const inferred = [{ id: "i1" }];
    const nodes = [node("i1", "Value"), node("n1", "Need"), node("o1", "Observation")];
    // you + 2 patterns + 1 today + 1 reading (i1 is today's, o1 is an act)
    expect(headspaceCount(patterns, inferred, nodes)).toBe(5);
  });

  it("is one on an account with nothing in it — there is still a point of view", () => {
    expect(headspaceCount([], [], [])).toBe(1);
  });

  it("does not count a reading twice for also being today's", () => {
    const nodes = [node("i1", "Value")];
    expect(headspaceCount([], [{ id: "i1" }], nodes)).toBe(2);
  });
});
