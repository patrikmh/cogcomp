import { describe, expect, it } from "vitest";

import { seed, sealRings } from "./seal";

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

/**
 * The exact shape, pinned.
 *
 * Verified against the running web client: these four strings are what the
 * browser has in its `<path d>` attributes for this id, and the mobile client
 * hands the same strings to Skia. That is what makes a seal recognition rather
 * than decoration — one shape drawn by two renderers, not two drawings of one
 * idea.
 *
 * A failure here is not necessarily a bug, but it is never a small change: every
 * seal every person has learned to recognise moves with it. `marks.ts` says the
 * same thing about its constants, and this is the test that makes that true
 * rather than hopeful.
 */
describe("the seal's geometry, pinned", () => {
  const id = "163b611c-6042-4bfa-8e3f-5c08fa2546a8";

  it("draws four rings", () => {
    expect(sealRings(id)).toHaveLength(4);
  });

  it("starts each ring where it has always started it", () => {
    expect(sealRings(id).map((d) => d.slice(0, 40))).toEqual([
      "M36.6 32.0L36.1 32.5L35.9 32.9L35.8 33.3",
      "M39.1 32.0L39.0 32.8L39.3 33.6L39.8 34.7",
      "M42.6 32.0L43.5 33.3L44.8 34.8L46.2 36.8",
      "M48.6 32.0L50.8 34.1L53.1 36.7L55.1 39.8",
    ]);
  });

  it("closes every ring, or the stroke leaves a gap", () => {
    for (const d of sealRings(id)) expect(d.endsWith("Z")).toBe(true);
  });

  it("gives a different id a different shape", () => {
    expect(sealRings("some-other-id")[0]).not.toBe(sealRings(id)[0]);
  });
});
