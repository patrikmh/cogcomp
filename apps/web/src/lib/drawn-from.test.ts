import { describe, expect, it } from "vitest";

import {
  amongOf,
  amongReadingsOf,
  aboutOf,
  amongThemesOf,
  apartSidesOf,
  changesOf,
  circlingOf,
  contradictsOf,
  detectorsWaiting,
  regionsOfReading,
  weekdayShapeOf,
  circlingThemesOf,
  themeMembersOf,
  travelsWithOf,
  feltTowardOf,
  indicatesOf,
  feltReadingOf,
  namedInnerOf,
  namedReadingOf,
  foldDrawnFrom,
  gatheredOf,
  innerFirst,
  innerReadingsOf,
  outerReadingsOf,
  returningInnerOf,
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

  it("leaves regions out — they belong to no single act", () => {
    const index = foldDrawnFrom([
      [
        reading(),
        reading({
          id: "t1",
          kind: "Theme",
          label: "rest, wired, late",
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

describe("gatheredOf", () => {
  it("walks several acts as one conversation, without repeating a door", () => {
    const rest = { id: "r1", label: "rest" };
    const late = { id: "r2", label: "late" };
    const index = new Map([
      ["e1", [rest]],
      ["e2", [rest, late]],
    ]);
    expect(gatheredOf(["e1", "e2", "e-none"], index).map((item) => item.id)).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("is empty when the conversation cited nothing", () => {
    expect(gatheredOf(["e1"], new Map())).toEqual([]);
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

describe("amongThemesOf", () => {
  const rest = { id: "t-rest", label: "rest, wired, late" };
  const work = { id: "t-work", label: "office, dread, late" };
  const cited = (id: string, sources: string[]) =>
    reading({ id, kind: "Theme", label: id, source_observation_ids: sources });

  it("indexes a region under the acts its members cite", () => {
    expect(amongThemesOf([[cited("t-rest", ["e1", "e2"])]], [rest]).get("e1")).toEqual([rest]);
    expect(foldDrawnFrom([[cited("t-rest", ["e1"])]]).get("e1")).toBeUndefined();
  });

  it("does not claim a stronger region the act is not in", () => {
    expect(amongThemesOf([[cited("t-rest", ["e1"])]], [work, rest]).get("e1")).toEqual([rest]);
  });

  it("ignores patterns when looking for regions", () => {
    expect(
      amongThemesOf([[reading({ id: "p-rest", kind: "Pattern", source_observation_ids: ["e1"] })]], [rest]).get(
        "e1",
      ),
    ).toBeUndefined();
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

describe("themeMembersOf", () => {
  const wired = { id: "e1", kind: "Emotion", label: "wired" };
  const rest = { id: "n1", kind: "Need", label: "rest" };
  const thought = { id: "th1", kind: "Thought", label: "I should call" };
  const sara = { id: "p1", kind: "Person", label: "Sara" };
  const office = { id: "pl1", kind: "Place", label: "the office" };
  const skip = { id: "a1", kind: "Activity", label: "skipping dinner" };

  it("puts thoughts and feelings in one room and the rest in the other", () => {
    expect(themeMembersOf([wired, sara, skip, rest, office, thought])).toEqual({
      inside: [wired, rest, thought],
      around: [sara, skip, office],
    });
  });

  it("leaves a room empty when the region has only one side", () => {
    expect(themeMembersOf([wired, rest])).toEqual({ inside: [wired, rest], around: [] });
    expect(themeMembersOf([sara, office])).toEqual({ inside: [], around: [sara, office] });
  });
});

describe("travelsWithOf", () => {
  const skip = { id: "a-skip", kind: "Activity", label: "skipping dinner" };
  const rest = { id: "n-rest", kind: "Need", label: "rest" };
  const loop = { id: "p-loop", kind: "Pattern", label: "wired came up on 4 days" };
  const region = { id: "t-rest", kind: "Theme", label: "rest, wired" };
  const entry = { id: "o1", kind: "Observation", label: "could not sleep" };

  it("keeps what shares an entry, in neighbour order", () => {
    expect(
      travelsWithOf(
        "e-wired",
        [skip, rest, loop],
        [
          { from_id: "e-wired", to_id: "a-skip", kind: "CO_OCCURS_WITH" },
          { from_id: "n-rest", to_id: "e-wired", kind: "CO_OCCURS_WITH" },
        ],
      ).map((item) => item.id),
    ).toEqual(["a-skip", "n-rest"]);
  });

  it("does not treat a support, a region, or a source entry as companionship", () => {
    expect(
      travelsWithOf(
        "e-wired",
        [skip, loop, region, entry],
        [
          { from_id: "e-wired", to_id: "p-loop", kind: "SUPPORTS" },
          { from_id: "e-wired", to_id: "t-rest", kind: "CO_OCCURS_WITH" },
          { from_id: "e-wired", to_id: "o1", kind: "DERIVED_FROM" },
          { from_id: "e-wired", to_id: "a-skip", kind: "TRIGGERED_BY" },
        ],
      ),
    ).toEqual([]);
  });
});

describe("feltTowardOf", () => {
  const sara = { id: "p-sara", kind: "Person", label: "Sara" };
  const office = { id: "pl-office", kind: "Place", label: "the office" };
  const wired = { id: "e-wired", kind: "Emotion", label: "wired" };
  const dread = { id: "e-dread", kind: "Emotion", label: "dread" };
  const loop = { id: "p-loop", kind: "Pattern", label: "wired came up on 4 days" };

  it("keeps who a feeling is aimed at, in neighbour order", () => {
    expect(
      feltTowardOf(
        "e-wired",
        [office, sara, loop],
        [
          { from_id: "e-wired", to_id: "pl-office", kind: "FELT_TOWARD" },
          { from_id: "e-wired", to_id: "p-sara", kind: "FELT_TOWARD" },
        ],
      ).toward.map((item) => item.id),
    ).toEqual(["pl-office", "p-sara"]);
  });

  it("keeps feelings aimed at this reading", () => {
    expect(
      feltTowardOf(
        "p-sara",
        [wired, dread],
        [
          { from_id: "e-wired", to_id: "p-sara", kind: "FELT_TOWARD" },
          { from_id: "e-dread", to_id: "p-sara", kind: "FELT_TOWARD" },
        ],
      ).from.map((item) => item.id),
    ).toEqual(["e-wired", "e-dread"]);
  });

  it("does not treat companionship or a cause as a direction", () => {
    expect(
      feltTowardOf(
        "e-wired",
        [sara, office, loop],
        [
          { from_id: "e-wired", to_id: "p-sara", kind: "CO_OCCURS_WITH" },
          { from_id: "e-wired", to_id: "pl-office", kind: "TRIGGERED_BY" },
          { from_id: "e-wired", to_id: "p-loop", kind: "FELT_TOWARD" },
        ],
      ),
    ).toEqual({ toward: [], from: [] });
  });
});

describe("aboutOf", () => {
  const sara = { id: "p-sara", kind: "Person", label: "Sara" };
  const call = { id: "t-call", kind: "Thought", label: "I should call" };
  const wired = { id: "e-wired", kind: "Emotion", label: "wired" };
  const loop = { id: "p-loop", kind: "Pattern", label: "wired came up on 4 days" };

  it("keeps the subject a thought names, in neighbour order", () => {
    expect(
      aboutOf(
        "t-call",
        [sara, wired, loop],
        [{ from_id: "t-call", to_id: "p-sara", kind: "ABOUT" }],
      ).about.map((item) => item.id),
    ).toEqual(["p-sara"]);
  });

  it("keeps what is about this reading", () => {
    expect(
      aboutOf(
        "p-sara",
        [call, wired],
        [
          { from_id: "t-call", to_id: "p-sara", kind: "ABOUT" },
          { from_id: "e-wired", to_id: "p-sara", kind: "ABOUT" },
        ],
      ).aboutThis.map((item) => item.id),
    ).toEqual(["t-call", "e-wired"]);
  });

  it("does not treat a feeling's direction or a cause as a subject", () => {
    expect(
      aboutOf(
        "e-wired",
        [sara, loop],
        [
          { from_id: "e-wired", to_id: "p-sara", kind: "FELT_TOWARD" },
          { from_id: "e-wired", to_id: "p-sara", kind: "TRIGGERED_BY" },
          { from_id: "e-wired", to_id: "p-loop", kind: "ABOUT" },
        ],
      ),
    ).toEqual({ about: [], aboutThis: [] });
  });
});

describe("indicatesOf", () => {
  const rest = { id: "n-rest", kind: "Need", label: "rest" };
  const sleep = { id: "v-sleep", kind: "Value", label: "sleep" };
  const wired = { id: "e-wired", kind: "Emotion", label: "wired" };
  const call = { id: "t-call", kind: "Thought", label: "I should call" };
  const sara = { id: "p-sara", kind: "Person", label: "Sara" };

  it("keeps the need a feeling hints at", () => {
    expect(
      indicatesOf(
        "e-wired",
        [rest, sleep, sara],
        [
          { from_id: "e-wired", to_id: "n-rest", kind: "INDICATES" },
          { from_id: "e-wired", to_id: "v-sleep", kind: "INDICATES" },
        ],
      ).hints.map((item) => item.id),
    ).toEqual(["n-rest", "v-sleep"]);
  });

  it("keeps the thoughts that hint at this need", () => {
    expect(
      indicatesOf(
        "n-rest",
        [wired, call, sara],
        [
          { from_id: "e-wired", to_id: "n-rest", kind: "INDICATES" },
          { from_id: "t-call", to_id: "n-rest", kind: "INDICATES" },
        ],
      ).hinted.map((item) => item.id),
    ).toEqual(["e-wired", "t-call"]);
  });

  it("does not treat a person, a subject, or a cause as this hint", () => {
    expect(
      indicatesOf(
        "e-wired",
        [sara, rest],
        [
          { from_id: "e-wired", to_id: "p-sara", kind: "INDICATES" },
          { from_id: "e-wired", to_id: "n-rest", kind: "ABOUT" },
          { from_id: "e-wired", to_id: "n-rest", kind: "TRIGGERED_BY" },
        ],
      ),
    ).toEqual({ hints: [], hinted: [] });
  });
});

describe("contradictsOf", () => {
  const capable = { id: "b-capable", kind: "Belief", label: "I am capable" };
  const loop = { id: "p-loop", kind: "Pattern", label: "I am bad at this came up on 4 days" };
  const doubt = { id: "t-doubt", kind: "Thought", label: "I will mess this up" };
  const rest = { id: "n-rest", kind: "Need", label: "rest" };
  const entry = { id: "o1", kind: "Observation", label: "could not sleep" };

  it("keeps the belief a thought sits against", () => {
    expect(
      contradictsOf(
        "t-doubt",
        [capable, loop, rest],
        [
          { from_id: "t-doubt", to_id: "b-capable", kind: "CONTRADICTS" },
          { from_id: "t-doubt", to_id: "p-loop", kind: "CONTRADICTS" },
        ],
      ).against.map((item) => item.id),
    ).toEqual(["b-capable", "p-loop"]);
  });

  it("keeps the thoughts that sit against this belief", () => {
    expect(
      contradictsOf(
        "b-capable",
        [doubt, rest],
        [{ from_id: "t-doubt", to_id: "b-capable", kind: "CONTRADICTS" }],
      ).againstThis.map((item) => item.id),
    ).toEqual(["t-doubt"]);
  });

  it("does not treat a need, an entry, or a support as this tension", () => {
    expect(
      contradictsOf(
        "t-doubt",
        [rest, entry, capable],
        [
          { from_id: "t-doubt", to_id: "n-rest", kind: "CONTRADICTS" },
          { from_id: "o1", to_id: "b-capable", kind: "CONTRADICTS" },
          { from_id: "t-doubt", to_id: "b-capable", kind: "SUPPORTS" },
        ],
      ),
    ).toEqual({ against: [], againstThis: [] });
  });
});

describe("regionsOfReading", () => {
  const rest = { id: "t-rest", members: ["rest", "wired", "late"] };
  const work = { id: "t-work", members: ["office", "dread", "late"] };
  const strongest = { id: "t-other", members: ["something else"] };

  it("keeps only regions that list this word", () => {
    expect(regionsOfReading("wired", [strongest, rest, work]).map((theme) => theme.id)).toEqual([
      "t-rest",
    ]);
  });

  it("does not claim a stronger region that does not list it", () => {
    expect(regionsOfReading("wired", [strongest, work, rest])).toEqual([rest]);
  });

  it("keeps the caller's order when the word sits in more than one region", () => {
    expect(regionsOfReading("late", [work, rest]).map((theme) => theme.id)).toEqual([
      "t-work",
      "t-rest",
    ]);
  });

  it("is empty when the word is blank", () => {
    expect(regionsOfReading("   ", [rest])).toEqual([]);
  });
});

describe("apartSidesOf", () => {
  const rest = { id: "n-rest", kind: "Need", label: "rest" };
  const late = { id: "a-late", kind: "Activity", label: "working late" };
  const wired = { id: "e-wired", kind: "Emotion", label: "wired" };
  const sara = { id: "p-sara", kind: "Person", label: "Sara" };

  it("keeps the named side apart from the recorded one", () => {
    expect(apartSidesOf([wired, rest, late, sara])).toEqual({
      named: [rest],
      done: [late],
    });
  });

  it("does not treat a feeling or a person as this gap", () => {
    expect(apartSidesOf([wired, sara])).toEqual({ named: [], done: [] });
  });

  it("keeps the caller's order on each side", () => {
    const sleep = { id: "v-sleep", kind: "Value", label: "sleep" };
    const stairs = { id: "a-stairs", kind: "Activity", label: "took the stairs" };
    expect(apartSidesOf([late, sleep, rest, stairs])).toEqual({
      named: [sleep, rest],
      done: [late, stairs],
    });
  });
});

describe("weekdayShapeOf", () => {
  it("counts calendar days Monday first", () => {
    expect(
      weekdayShapeOf(["2026-04-06", "2026-04-07", "2026-04-13", "2026-04-09"]).map(
        (day) => `${day.weekday}:${day.count}`,
      ),
    ).toEqual(["Mon:2", "Tue:1", "Wed:0", "Thu:1", "Fri:0", "Sat:0", "Sun:0"]);
  });

  it("ignores unreadable instants", () => {
    expect(weekdayShapeOf(["not-a-day"]).every((day) => day.count === 0)).toBe(true);
  });
});

describe("detectorsWaiting", () => {
  it("names within-day ordering separately from day-apart ordering", () => {
    const waiting = detectorsWaiting({ days: 20, weeks: 4, found: ["lag"] });
    expect(waiting.map((item) => item.name)).toContain("Ordering, within a day");
    expect(waiting.find((item) => item.name === "Ordering")?.standing).toBe("found");
    expect(waiting.find((item) => item.name === "Ordering, within a day")?.standing).not.toBe(
      "found",
    );
  });

  it("marks within-day ordering found only when that detector has fired", () => {
    const waiting = detectorsWaiting({ days: 4, weeks: 1, found: ["same-day-order"] });
    expect(waiting.find((item) => item.name === "Ordering, within a day")).toMatchObject({
      standing: "found",
      ready: true,
    });
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

describe("innerFirst", () => {
  it("puts a faint feeling ahead of a sure activity", () => {
    const rest = { kind: "Need", label: "rest", confidence: 0.4 };
    const stairs = { kind: "Activity", label: "took the stairs", confidence: 0.95 };
    expect([stairs, rest].sort(innerFirst).map((item) => item.label)).toEqual([
      "rest",
      "took the stairs",
    ]);
  });

  it("still orders surest-first inside the inner room", () => {
    const rest = { kind: "Need", label: "rest", confidence: 0.4 };
    const wired = { kind: "Emotion", label: "wired", confidence: 0.8 };
    expect([rest, wired].sort(innerFirst).map((item) => item.label)).toEqual(["wired", "rest"]);
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

describe("returningInnerOf", () => {
  const rest = { kind: "Need", label: "rest", cites_days: 4, confidence: 0.4 };
  const wired = { kind: "Emotion", label: "wired", cites_days: 2, confidence: 0.8 };
  const once = { kind: "Need", label: "sleep", cites_days: 1, confidence: 0.9 };
  const stairs = { kind: "Activity", label: "stairs", cites_days: 5, confidence: 0.9 };

  it("keeps a feeling that returned across days, never an act", () => {
    expect(returningInnerOf([stairs, once, rest]).map((item) => item.label)).toEqual(["rest"]);
  });

  it("orders by how often it came back, then surest inside", () => {
    expect(returningInnerOf([wired, rest]).map((item) => item.label)).toEqual(["rest", "wired"]);
  });

  it("on a day, two acts naming the same feeling is enough", () => {
    const today = { kind: "Need", label: "rest", cites_entries: 2, confidence: 0.5 };
    const single = { kind: "Need", label: "sleep", cites_entries: 1, confidence: 0.9 };
    expect(returningInnerOf([single, today]).map((item) => item.label)).toEqual(["rest"]);
  });
});

describe("changesOf", () => {
  const rest = { kind: "Need", label: "rest", shift: "more" };
  const coffee = { kind: "Activity", label: "coffee", shift: "less" };
  const region = { kind: "Theme", label: "rest · coffee", shift: "new" };

  it("keeps a need inside and an act around, in the caller's order", () => {
    expect(changesOf([coffee, rest, coffee]).inside.map((item) => item.label)).toEqual(["rest"]);
    expect(changesOf([coffee, rest, coffee]).around.map((item) => item.label)).toEqual([
      "coffee",
      "coffee",
    ]);
  });

  it("does not treat a region as something that moved in either room", () => {
    expect(changesOf([region])).toEqual({ inside: [], around: [] });
  });
});

describe("namedReadingOf", () => {
  const rest = { id: "n1", kind: "Need", label: "rest", confidence: 0.4 };
  const surer = { id: "n2", kind: "Need", label: "Rest", confidence: 0.8 };
  const stairs = { id: "a1", kind: "Activity", label: "rest", confidence: 0.9 };

  it("opens the surer reading of the same kind and word", () => {
    expect(namedReadingOf("Need", "rest", [rest, stairs, surer])?.id).toBe("n2");
  });

  it("does not open an act that happens to share the word", () => {
    expect(namedReadingOf("Need", "rest", [stairs])).toBeUndefined();
  });

  it("opens nothing when the name is blank", () => {
    expect(namedReadingOf("Need", "  ", [rest])).toBeUndefined();
  });
});

describe("namedInnerOf", () => {
  const rest = { id: "n1", kind: "Need", label: "rest", confidence: 0.4 };
  const surer = { id: "e1", kind: "Emotion", label: "Rest", confidence: 0.8 };
  const stairs = { id: "a1", kind: "Activity", label: "rest", confidence: 0.9 };

  it("keeps only inner readings the record named with that exact word", () => {
    expect(namedInnerOf("rest", [stairs, rest, surer]).map((item) => item.kind)).toEqual([
      "Emotion",
      "Need",
    ]);
  });

  it("does not treat a partial word as a name", () => {
    expect(namedInnerOf("re", [rest])).toEqual([]);
  });

  it("is empty when nothing was asked for", () => {
    expect(namedInnerOf("  ", [rest])).toEqual([]);
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
