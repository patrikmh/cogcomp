import { describe, expect, it } from "vitest";

import { seed } from "./seal";

/**
 * The seal a record carries.
 *
 * A seal is an identity, not a decoration: the same entry must be stamped the
 * same way on every screen and in every session, or two views of one record
 * look like two records. That means the PRNG behind it has to be a pure
 * function of the id and nothing else — no time, no counter, no shared state.
 */
describe("seed", () => {
  it("gives the same sequence for the same id", () => {
    const a = seed("entry-1");
    const b = seed("entry-1");
    const first = [a(), a(), a(), a(), a()];
    const second = [b(), b(), b(), b(), b()];
    expect(first).toEqual(second);
  });

  it("gives different sequences for different ids", () => {
    const a = seed("entry-1");
    const b = seed("entry-2");
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it("stays inside the unit interval", () => {
    const rnd = seed("d3ad-b33f");
    for (let i = 0; i < 500; i++) {
      const value = rnd();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("does not depend on how many other seals have been drawn", () => {
    // Two generators interleaved must not contaminate each other, or a seal
    // would change depending on where it sat in a list.
    const a = seed("same");
    const noise = seed("other");
    noise();
    noise();
    const b = seed("same");
    expect([a(), a()]).toEqual([b(), b()]);
  });
});
