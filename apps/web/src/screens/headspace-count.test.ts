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
    expect(readingsOn(nodes, new Set())).toHaveLength(20);
  });

  it("gives way to the patterns, which are the point of the map", () => {
    // Every extra whorl shrinks all the others, because the camera frames the
    // whole massif. Ten patterns means ten fewer readings, not ten more whorls.
    const nodes = Array.from({ length: 60 }, (_, i) => node(`n${i}`, "Value"));
    expect(readingsOn(nodes, new Set(), 10)).toHaveLength(10);
  });

  it("never starves the readings entirely, however many patterns there are", () => {
    const nodes = Array.from({ length: 60 }, (_, i) => node(`n${i}`, "Value"));
    expect(readingsOn(nodes, new Set(), 40)).toHaveLength(6);
  });

  it("keeps a feeling when the graph is full of acts", () => {
    const stairs = Array.from({ length: 20 }, (_, i) => node(`stairs-${i}`, "Activity"));
    expect(readingsOn([...stairs, node("rest", "Need")], new Set()).map((n) => n.id)).toContain(
      "rest",
    );
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
