import { describe, expect, it } from "vitest";

import { foldDrawnFrom } from "./drawn-from";

/**
 * What an act left behind.
 *
 * The chips under an entry say "drawn from this", so what appears there has to
 * be something that entry actually produced. The distinction these pin down is
 * between a reading, which comes from acts, and a pattern, which is a statement
 * about many of them and belongs to none.
 */
const reading = (over: Partial<Parameters<typeof foldDrawnFrom>[0][0][0]> = {}) => ({
  id: "r1",
  kind: "Need",
  label: "rest",
  confidence: 0.82,
  tentative: false,
  source_observation_ids: ["e1"],
  ...over,
});

describe("foldDrawnFrom", () => {
  it("indexes a reading under every act it cites", () => {
    const index = foldDrawnFrom([[reading({ source_observation_ids: ["e1", "e2"] })]]);
    expect(index.get("e1")?.map((r) => r.label)).toEqual(["rest"]);
    expect(index.get("e2")?.map((r) => r.label)).toEqual(["rest"]);
  });

  it("leaves patterns out — they belong to no single act", () => {
    const index = foldDrawnFrom([
      [
        reading(),
        reading({
          id: "p1",
          kind: "Pattern",
          label: "rest came up on 9 days, working late on 9 days",
          source_observation_ids: ["e1"],
        }),
      ],
    ]);
    expect(index.get("e1")?.map((r) => r.label)).toEqual(["rest"]);
  });

  it("does not list the same reading twice when weeks overlap", () => {
    const index = foldDrawnFrom([[reading()], [reading()]]);
    expect(index.get("e1")).toHaveLength(1);
  });

  it("keeps two different readings on the same act", () => {
    const index = foldDrawnFrom([[reading(), reading({ id: "r2", label: "working late" })]]);
    expect(index.get("e1")?.map((r) => r.label)).toEqual(["rest", "working late"]);
  });

  it("carries tentativeness through, so a guess is still drawn as a guess", () => {
    const index = foldDrawnFrom([[reading({ tentative: true, confidence: 0.33 })]]);
    expect(index.get("e1")?.[0]).toMatchObject({ tentative: true, confidence: 0.33 });
  });

  it("is empty for an act nothing was drawn from", () => {
    const index = foldDrawnFrom([[reading()]]);
    expect(index.get("e-none")).toBeUndefined();
  });
});
