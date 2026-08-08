import { describe, expect, it } from "vitest";

import { litCells } from "./Experiments";

/**
 * How many days of an experiment's arc are lit.
 *
 * The strip is illustrative about *which* days — the caption says so — but the
 * count has to be a fact, because it sits directly beside "1 of 14 check-ins".
 * It used to light each cell with probability `checkins / duration`, so one
 * check-in across a fortnight usually lit nothing, and a person who had come
 * back to their own experiment saw an empty arc next to a number saying they
 * had not.
 */
describe("litCells", () => {
  it("lights exactly as many days as there were check-ins", () => {
    expect(litCells("x", 14, 6, "active").size).toBe(6);
    expect(litCells("x", 14, 1, "active").size).toBe(1);
  });

  it("lights nothing before an experiment has started", () => {
    expect(litCells("x", 14, 3, "draft").size).toBe(0);
  });

  it("cannot light more days than the experiment has", () => {
    expect(litCells("x", 7, 99, "active").size).toBe(7);
  });

  it("is stable — the same arc twice is the same arc", () => {
    expect([...litCells("x", 14, 5, "active")]).toEqual([...litCells("x", 14, 5, "active")]);
  });

  it("gives different experiments different shapes", () => {
    const a = [...litCells("one", 14, 5, "active")];
    const b = [...litCells("two", 14, 5, "active")];
    expect(a).not.toEqual(b);
  });

  it("stays inside the strip", () => {
    for (const day of litCells("x", 10, 4, "active")) {
      expect(day).toBeGreaterThanOrEqual(0);
      expect(day).toBeLessThan(10);
    }
  });
});
