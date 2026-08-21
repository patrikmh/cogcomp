import { describe, expect, it } from "vitest";

import {
  amongOf,
  amongReadingsOf,
  circlingOf,
  circlingThemesOf,
  feltReadingOf,
  foldDrawnFrom,
  innerReadingsOf,
  outerReadingsOf,
  vocabularyMarks,
} from "./drawn-from";

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

describe("amongOf", () => {
  const rest = { id: "p-rest", label: "rest came up on 4 days" };
  const late = { id: "p-late", label: "working late came up on 3 days" };
  const strongest = { id: "p-other", label: "something else entirely" };
  const cited = (id: string, sources: string[]) =>
    reading({ id, kind: "Pattern", label: id, source_observation_ids: sources });

  it("indexes a pattern under the acts it cites, not as drawn from them", () => {
    expect(amongOf([[cited("p-rest", ["e1", "e2"])]], [rest]).get("e1")).toEqual([rest]);
    expect(foldDrawnFrom([[cited("p-rest", ["e1"])]]).get("e1")).toBeUndefined();
  });

  it("does not claim a stronger pattern the act is not among", () => {
    expect(amongOf([[cited("p-rest", ["e1"])]], [strongest, rest, late]).get("e1")).toEqual([rest]);
  });

  it("keeps the caller's order so strongest-among-these stays first", () => {
    expect(
      amongOf([[cited("p-rest", ["e1"]), cited("p-late", ["e1"])]], [late, rest])
        .get("e1")
        ?.map((pattern) => pattern.id),
    ).toEqual(["p-late", "p-rest"]);
  });

  it("ignores readings that are not patterns", () => {
    expect(amongOf([[reading()]], [rest]).get("e1")).toBeUndefined();
  });
});

describe("circlingOf", () => {
  const rest = { id: "p-rest", label: "rest" };
  const late = { id: "p-late", label: "working late" };
  const strongest = { id: "p-other", label: "something else entirely" };

  it("keeps only patterns that cite the day's material", () => {
    expect(
      circlingOf(
        [
          { id: "r1", kind: "Need" },
          { id: "p-late", kind: "Pattern" },
        ],
        [strongest, rest, late],
      ).map((pattern) => pattern.id),
    ).toEqual(["p-late"]);
  });

  it("does not surface the strongest pattern just because it is first", () => {
    expect(circlingOf([{ id: "p-rest", kind: "Pattern" }], [strongest, rest, late])).toEqual([rest]);
  });

  it("is empty when the day has readings but no pattern provenance", () => {
    expect(circlingOf([{ id: "r1", kind: "Need" }], [strongest, rest])).toEqual([]);
  });

  it("preserves the caller's order so strongest-among-the-day stays first", () => {
    expect(
      circlingOf(
        [
          { id: "p-rest", kind: "Pattern" },
          { id: "p-late", kind: "Pattern" },
        ],
        [late, rest],
      ).map((pattern) => pattern.id),
    ).toEqual(["p-late", "p-rest"]);
  });
});

describe("circlingThemesOf", () => {
  const restWired = { id: "t-rest", label: "rest · wired" };
  const work = { id: "t-work", label: "desk · late" };
  const strongest = { id: "t-other", label: "something else entirely" };

  it("keeps only regions that cite the day's material", () => {
    expect(
      circlingThemesOf(
        [
          { id: "r1", kind: "Need" },
          { id: "t-rest", kind: "Theme" },
        ],
        [strongest, restWired, work],
      ).map((theme) => theme.id),
    ).toEqual(["t-rest"]);
  });

  it("does not surface the strongest region just because it is first", () => {
    expect(circlingThemesOf([{ id: "t-rest", kind: "Theme" }], [strongest, restWired, work])).toEqual([
      restWired,
    ]);
  });

  it("is empty when the day has readings but no region provenance", () => {
    expect(circlingThemesOf([{ id: "r1", kind: "Need" }], [strongest, restWired])).toEqual([]);
  });
});

describe("vocabularyMarks", () => {
  it("names first-time words instead of counting them", () => {
    expect(
      vocabularyMarks({ words: ["wired", "flat", "restless"], first_time: ["restless"] }),
    ).toEqual([
      { word: "wired", firstTime: false },
      { word: "flat", firstTime: false },
      { word: "restless", firstTime: true },
    ]);
  });

  it("does not mark every word first-time just because the list is this week's", () => {
    expect(
      vocabularyMarks({ words: ["wired", "flat"], first_time: [] }).every((mark) => mark.firstTime),
    ).toBe(false);
  });

  it("ignores a first-time label that is not in the week's words", () => {
    expect(vocabularyMarks({ words: ["wired"], first_time: ["wired", "absent"] })).toEqual([
      { word: "wired", firstTime: true },
    ]);
  });
});

describe("feltReadingOf", () => {
  const wired = { id: "e-wired", kind: "Emotion", label: "Wired", confidence: 0.6 };
  const rest = { id: "n-rest", kind: "Need", label: "rest", confidence: 0.8 };
  const stairs = { id: "a-rest", kind: "Activity", label: "rest", confidence: 0.99 };

  it("opens the felt reading that shares the word", () => {
    expect(feltReadingOf("wired", [wired, rest])?.id).toBe("e-wired");
  });

  it("does not open an activity that happens to share the label", () => {
    expect(feltReadingOf("rest", [stairs, rest])?.id).toBe("n-rest");
  });

  it("opens the surer reading when two felt ones share a label", () => {
    const faint = { id: "e-faint", kind: "Emotion", label: "wired", confidence: 0.4 };
    expect(feltReadingOf("wired", [faint, wired])?.id).toBe("e-wired");
  });

  it("is empty when the week has the word but no felt reading", () => {
    expect(feltReadingOf("wired", [stairs])).toBeUndefined();
  });
});

describe("inner and outer readings", () => {
  const wired = { kind: "Emotion", label: "wired" };
  const rest = { kind: "Need", label: "rest" };
  const thought = { kind: "Thought", label: "I should call" };
  const stairs = { kind: "Activity", label: "took the stairs" };
  const sara = { kind: "Person", label: "Sara" };
  const loop = { kind: "Pattern", label: "wired came up on 4 days" };

  it("keeps thoughts and feelings out of the outer week", () => {
    expect(innerReadingsOf([wired, stairs, thought, rest, sara]).map((item) => item.label)).toEqual([
      "wired",
      "I should call",
      "rest",
    ]);
    expect(outerReadingsOf([wired, stairs, thought, rest, sara]).map((item) => item.label)).toEqual([
      "took the stairs",
      "Sara",
    ]);
  });

  it("does not treat a pattern as something felt or done", () => {
    expect(innerReadingsOf([loop])).toEqual([]);
    expect(outerReadingsOf([loop])).toEqual([]);
  });

  it("does not treat a region as something felt or done", () => {
    expect(outerReadingsOf([{ kind: "Theme", label: "rest · wired · late" }])).toEqual([]);
  });
});

describe("amongReadingsOf", () => {
  const rest = { id: "p-rest", label: "rest came up on 4 days" };
  const late = { id: "p-late", label: "working late came up on 3 days" };

  it("keeps the recurrences a reading supports, in the caller's order", () => {
    expect(
      amongReadingsOf(
        [
          { id: "p-rest", kind: "Pattern" },
          { id: "a1", kind: "Activity" },
          { id: "p-late", kind: "Pattern" },
        ],
        [late, rest],
      ).map((pattern) => pattern.id),
    ).toEqual(["p-late", "p-rest"]);
  });

  it("does not claim a stronger pattern the reading does not support", () => {
    expect(amongReadingsOf([{ id: "p-rest", kind: "Pattern" }], [late, rest])).toEqual([rest]);
  });
});
